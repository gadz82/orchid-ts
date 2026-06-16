import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { OrchidAgentsConfig } from "./schema/agent.js";
import { buildAgentsConfig } from "./schema/agent.js";
import { OrchidConfigError, ConfigLoadError, ConfigValidationError } from "./errors.js";
import { ZodError } from "zod";

const ENV_VAR_RE = /\$\{(\w+)\}/g;

function findCommentStart(line: string): number | null {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (ch === "#" && !inSingle && !inDouble) {
            return i;
        }
    }
    return null;
}

function interpolateEnv(raw: string): string {
    const lines: string[] = [];
    for (const line of raw.split("\n")) {
        const commentIdx = findCommentStart(line);
        if (commentIdx !== null) {
            const codePart = line.slice(0, commentIdx);
            const commentPart = line.slice(commentIdx);
            lines.push(
                codePart.replace(ENV_VAR_RE, (_match, varName: string) => {
                    const value = process.env[varName];
                    if (value === undefined) {
                        throw new OrchidConfigError(
                            `Environment variable '${varName}' is referenced in agents.yaml but not set. Add it to your .env or environment.`,
                        );
                    }
                    return value;
                }) + commentPart,
            );
        } else {
            lines.push(
                line.replace(ENV_VAR_RE, (_match, varName: string) => {
                    const value = process.env[varName];
                    if (value === undefined) {
                        throw new OrchidConfigError(
                            `Environment variable '${varName}' is referenced in agents.yaml but not set. Add it to your .env or environment.`,
                        );
                    }
                    return value;
                }),
            );
        }
    }
    return lines.join("\n");
}

export function loadConfig(path: string): OrchidAgentsConfig {
    let resolvedPath = path;
    if (!resolvedPath.startsWith("/") && !/^[A-Z]:/.test(resolvedPath)) {
        // Try relative to this module's parent directory (orchid-ts root)
        const moduleParent = dirname(dirname(resolve(import.meta.dirname || __dirname)));
        const candidate = resolve(moduleParent, path);
        try {
            readFileSync(candidate);
            resolvedPath = candidate;
        } catch {
            // Use cwd-relative — let it fail naturally if not found
        }
    }

    let rawText: string;
    try {
        rawText = readFileSync(resolvedPath, "utf-8");
    } catch {
        throw new ConfigLoadError(`Agents config not found: ${resolvedPath}`, resolvedPath);
    }

    const interpolated = interpolateEnv(rawText);

    let data: unknown;
    try {
        data = parseYaml(interpolated);
    } catch (err) {
        throw new ConfigLoadError(
            `Failed to parse YAML from ${resolvedPath}: ${(err as Error).message}`,
            resolvedPath,
        );
    }

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new ConfigLoadError(
            `Expected YAML dict at top level, got ${Array.isArray(data) ? "array" : typeof data}`,
            resolvedPath,
        );
    }

    try {
        const config = buildAgentsConfig(data as Record<string, unknown>);
        return config;
    } catch (err) {
        if (err instanceof ZodError) {
            throw new ConfigValidationError(
                `Config validation failed for ${resolvedPath}`,
                err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
            );
        }
        throw err;
    }
}
