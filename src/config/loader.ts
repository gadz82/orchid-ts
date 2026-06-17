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

/**
 * Deep-convert snake_case object keys to camelCase. The TS port's zod schemas
 * use camelCase (TypeScript convention) but the Python port — and
 * `applyYamlToEnv` — use snake_case YAML keys. Without this conversion,
 * YAML fields like `ollama_api_base` or `fallback_model` are silently
 * dropped during schema validation, leaving the schema defaults in place.
 * Arrays are walked (objects inside arrays are converted), primitives
 * are left untouched.
 */
function snakeToCamel(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(snakeToCamel);
    }
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            const camelKey = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
            out[camelKey] = snakeToCamel(val);
        }
        return out;
    }
    return value;
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

    // Convert snake_case keys to camelCase so YAML using the Python
    // convention (e.g. `ollama_api_base`, `fallback_model`) matches the
    // TS port's camelCase zod schema fields.
    data = snakeToCamel(data);

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new ConfigLoadError(
            `Expected YAML dict at top level, got ${Array.isArray(data) ? "array" : typeof data}`,
            resolvedPath,
        );
    }

    const dataObj = data as Record<string, unknown>;

    // Python-port compatibility: the Python `orchid.yml` puts LLM / RAG /
    // auth / storage / tracing under nested top-level keys (`llm:`,
    // `rag:`, `auth:`, `storage:`, `tracing:`). The TS zod schema expects
    // the same fields under `defaults.llm` / `defaults.rag` / etc. (or
    // maps them through `applyYamlToEnv` to env vars). Merge any top-level
    // nested blocks into the equivalent `defaults.*` slot so the same
    // YAML works on both ports. Existing flat keys (e.g. `default_model`,
    // `vector_backend`) keep their precedence.
    mergeTopLevelIntoDefaults(dataObj);

    // Follow the Python port's `agents.config_path` pattern: if the main
    // config references a separate agents YAML (either inline as
    // `agents.config_path: ./agents.yaml` or via the `AGENTS_CONFIG_PATH`
    // env var), load that file and merge its `agents:` section into the
    // main config. The `agents.config_path` key is stripped from the main
    // config so it doesn't pollute the final `agents` record.
    const agentsObj = dataObj["agents"];
    if (agentsObj !== null && typeof agentsObj === "object" && !Array.isArray(agentsObj)) {
        const agentsRecord = agentsObj as Record<string, unknown>;
        const inlineConfigPath =
            typeof agentsRecord["configPath"] === "string"
                ? (agentsRecord["configPath"] as string)
                : null;
        const envConfigPath = process.env["AGENTS_CONFIG_PATH"] || null;
        const agentsConfigPath = inlineConfigPath ?? envConfigPath;
        if (agentsConfigPath) {
            dataObj["agents"] = loadAndMergeAgentsConfig(
                agentsConfigPath,
                resolvedPath,
                agentsRecord,
            );
        }
    }

    try {
        const config = buildAgentsConfig(dataObj);
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

/**
 * Load a separate agents YAML file and merge its `agents:` section into
 * the inline `agents` record from the main config. Supports both the
 * Python-style top-level `agents:` key and a top-level `defaults:`
 * block (mirroring the Python `agents.yaml` shape). The inline
 * `configPath` key is dropped from the result.
 */
function loadAndMergeAgentsConfig(
    agentsConfigPath: string,
    mainConfigPath: string,
    inlineAgents: Record<string, unknown>,
): Record<string, unknown> {
    const resolved = resolveAgentsConfigPath(agentsConfigPath, mainConfigPath);
    let rawText: string;
    try {
        rawText = readFileSync(resolved, "utf-8");
    } catch {
        throw new ConfigLoadError(
            `Agents config not found: ${agentsConfigPath}`,
            agentsConfigPath,
        );
    }
    let parsed: unknown;
    try {
        parsed = parseYaml(rawText);
    } catch (err) {
        throw new ConfigLoadError(
            `Failed to parse agents YAML from ${agentsConfigPath}: ${(err as Error).message}`,
            agentsConfigPath,
        );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ConfigLoadError(
            `Expected YAML dict at top level of agents config ${agentsConfigPath}`,
            agentsConfigPath,
        );
    }
    const agentsData = snakeToCamel(parsed) as Record<string, unknown>;
    const fileAgents = agentsData["agents"];
    if (fileAgents === null || typeof fileAgents !== "object" || Array.isArray(fileAgents)) {
        throw new ConfigLoadError(
            `Agents config ${agentsConfigPath} is missing an "agents" section`,
            agentsConfigPath,
        );
    }
    // Merge: file agents take priority over inline agents when keys collide.
    return { ...(fileAgents as Record<string, unknown>), ...inlineAgents };
}

function resolveAgentsConfigPath(agentsConfigPath: string, mainConfigPath: string): string {
    if (agentsConfigPath.startsWith("/") || /^[A-Z]:/.test(agentsConfigPath)) {
        return agentsConfigPath;
    }
    const mainDir = dirname(resolve(mainConfigPath));
    return resolve(mainDir, agentsConfigPath);
}

/**
 * Merge the Python-port top-level sections (`llm`, `rag`, `auth`,
 * `storage`, `tracing`) into the TS port's `defaults.*` slots. Existing
 * `defaults.*` fields take precedence so the TS examples that already
 * use the flat/structurally-different keys keep working.
 */
function mergeTopLevelIntoDefaults(data: Record<string, unknown>): void {
    const defaults = (data["defaults"] ?? {}) as Record<string, unknown>;
    const sections: Array<[string, string]> = [
        ["llm", "llm"],
        ["rag", "rag"],
    ];
    for (const [topKey, defaultKey] of sections) {
        const topSection = data[topKey];
        if (topSection === null || typeof topSection !== "object" || Array.isArray(topSection)) {
            continue;
        }
        const defaultSection = (defaults[defaultKey] ?? {}) as Record<string, unknown>;
        if (typeof defaultSection !== "object" || defaultSection === null || Array.isArray(defaultSection)) {
            continue;
        }
        defaults[defaultKey] = { ...topSection, ...defaultSection };
    }
    data["defaults"] = defaults;
}
