import { readFileSync, readdirSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { MarkdownFile } from "./frontmatter.js";
import { loadMarkdownFile } from "./frontmatter.js";
import { buildAgentsConfig } from "./schema/agent.js";
import type { OrchidAgentsConfig } from "./schema/agent.js";

const ENV_VAR_RE = /\$\{(\w+)\}/g;

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

const RAG_BEHAVIOUR_KEYS = new Set([
    "k",
    "enabled",
    "ragTtl",
    "maxContextChars",
    "ingestion",
    "retrieval",
]);

function mergeTopLevelIntoDefaults(data: Record<string, unknown>): void {
    const defaults = (data["defaults"] ?? {}) as Record<string, unknown>;

    const llmSection = data["llm"];
    if (
        llmSection !== null &&
        typeof llmSection === "object" &&
        !Array.isArray(llmSection)
    ) {
        const defaultLlm = (defaults["llm"] ?? {}) as Record<string, unknown>;
        if (typeof defaultLlm === "object" && defaultLlm !== null && !Array.isArray(defaultLlm)) {
            defaults["llm"] = { ...llmSection, ...defaultLlm };
        }
    }

    const ragSection = data["rag"];
    if (
        ragSection !== null &&
        typeof ragSection === "object" &&
        !Array.isArray(ragSection)
    ) {
        const defaultRag = (defaults["rag"] ?? {}) as Record<string, unknown>;
        if (typeof defaultRag === "object" && defaultRag !== null && !Array.isArray(defaultRag)) {
            const behaviourOnly: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(ragSection as Record<string, unknown>)) {
                if (RAG_BEHAVIOUR_KEYS.has(key)) {
                    behaviourOnly[key] = value;
                }
            }
            defaults["rag"] = { ...behaviourOnly, ...defaultRag };
        }
    }

    data["defaults"] = defaults;
}

function interpolateEnv(raw: string): string {
    return raw.replace(ENV_VAR_RE, (_match, varName: string) => {
        const value = process.env[varName];
        if (value === undefined) {
            throw new Error(
                `Environment variable '${varName}' is referenced in config but not set.`,
            );
        }
        return value;
    });
}

function inferAgentName(filePath: string): string {
    const base = basename(filePath);
    return basename(base, extname(base));
}

function mergeAgentMd(md: MarkdownFile): Record<string, unknown> {
    const data: Record<string, unknown> = snakeToCamel(md.frontmatter) as Record<string, unknown>;
    data.prompt = md.body;
    return data;
}

function loadAgents(agentsDir: string): {
    agentConfigs: Record<string, Record<string, unknown>>;
    fileHashes: Record<string, string>;
} {
    let entries: string[];
    try {
        entries = readdirSync(agentsDir);
    } catch {
        return { agentConfigs: {}, fileHashes: {} };
    }

    const mdFiles = entries.filter((e) => e.endsWith(".md")).sort();
    const agentConfigs: Record<string, Record<string, unknown>> = {};
    const fileHashes: Record<string, string> = {};

    for (const file of mdFiles) {
        const filePath = resolve(agentsDir, file);
        const agentName = inferAgentName(filePath);

        if (agentName in agentConfigs) {
            throw new Error(
                `Duplicate agent name '${agentName}' from files '${filePath}' and another in '${agentsDir}'. ` +
                    `Rename one of the files.`,
            );
        }

        const agentMd = loadMarkdownFile(filePath);
        agentConfigs[agentName] = mergeAgentMd(agentMd);
        fileHashes[filePath] = agentMd.sha256;
    }

    return { agentConfigs, fileHashes };
}

function resolveAgentsDir(
    rootPath: string,
    frontmatter: Record<string, unknown>,
    agentsDir?: string,
): string {
    if (agentsDir) {
        return resolve(rootPath, "..", agentsDir);
    }

    const agentsSection = frontmatter.agents as Record<string, unknown> | undefined;
    const dirName =
        typeof agentsSection?.agents_dir === "string" ? agentsSection.agents_dir : undefined;

    if (dirName) {
        return resolve(rootPath, "..", dirName);
    }

    return resolve(rootPath, "..", "agents");
}

export function buildConfigDataFromYaml(
    yamlData: Record<string, unknown>,
    agentConfigs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
    // OrchidAgentsConfig field names from the schema
    const agentBehaviourFields = new Set([
        "version",
        "defaults",
        "tools",
        "skills",
        "supervisor",
        "guardrails",
        "mcpGateway",
        "agents",
        "allowedPassthroughHosts",
        "events",
        "configStorage",
    ]);

    const configData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(yamlData)) {
        if (agentBehaviourFields.has(key)) {
            configData[key] = value;
        }
    }

    configData.agents = agentConfigs;
    return configData;
}

export function loadMdConfig(
    rootPath: string,
    agentsDir?: string,
): { config: OrchidAgentsConfig; fileHashes: Record<string, string> } {
    const resolved = resolve(rootPath);

    let rawText: string;
    try {
        rawText = readFileSync(resolved, "utf-8");
    } catch {
        throw new Error(`Markdown config not found: ${resolved}`);
    }

    const interpolated = interpolateEnv(rawText);
    const rootMd = loadMarkdownFile(resolved);
    // Re-parse after interpolation so ${VAR} placeholders in frontmatter are resolved.
    const { frontmatter: interpolatedFm } = parseFrontmatterForLoad(interpolated);

    const fileHashes: Record<string, string> = { [resolved]: rootMd.sha256 };
    let rootFm = { ...interpolatedFm };

    rootFm = snakeToCamel(rootFm) as Record<string, unknown>;
    mergeTopLevelIntoDefaults(rootFm);

    const agentsDirPath = resolveAgentsDir(resolved, rootFm, agentsDir);

    const { agentConfigs, fileHashes: agentHashes } = loadAgents(agentsDirPath);
    Object.assign(fileHashes, agentHashes);

    const configData = buildConfigDataFromYaml(rootFm, agentConfigs);

    const config = buildAgentsConfig(configData);
    return { config, fileHashes };
}

function parseFrontmatterForLoad(text: string): { frontmatter: Record<string, unknown>; body: string } {
    // Reuse the parser from frontmatter.ts by loading the file through its interface.
    // We avoid importing loadMarkdownFile with raw text, so parse inline.
    let normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (normalized.startsWith("\ufeff")) {
        normalized = normalized.slice(1);
    }

    if (!normalized.startsWith("---\n")) {
        return { frontmatter: {}, body: normalized.trim() };
    }

    const openingEnd = normalized.indexOf("\n") + 1;
    const rest = normalized.slice(openingEnd);

    if (rest.startsWith("---\n")) {
        return { frontmatter: {}, body: rest.slice(4).trim() };
    }
    if (rest.trimEnd() === "---") {
        return { frontmatter: {}, body: "" };
    }

    const delimIdx = rest.indexOf("\n---");
    if (delimIdx === -1) {
        return { frontmatter: {}, body: normalized.trim() };
    }

    const fmText = rest.slice(0, delimIdx);
    let body = rest.slice(delimIdx + 4);
    if (body.startsWith("\n")) {
        body = body.slice(1);
    }
    body = body.trim();

    if (!fmText.trim()) {
        return { frontmatter: {}, body };
    }

    try {
        const parsed = parseYaml(fmText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return { frontmatter: {}, body };
        }
        return { frontmatter: parsed as Record<string, unknown>, body };
    } catch {
        return { frontmatter: {}, body };
    }
}
