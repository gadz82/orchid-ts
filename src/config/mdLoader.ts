import { readdirSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import type { MarkdownFile } from "./frontmatter.js";
import { loadMarkdownFile } from "./frontmatter.js";
import { buildAgentsConfig } from "./schema/agent.js";
import type { OrchidAgentsConfig } from "./schema/agent.js";

function inferAgentName(filePath: string): string {
    const base = basename(filePath);
    return basename(base, extname(base));
}

function mergeAgentMd(md: MarkdownFile): Record<string, unknown> {
    const data: Record<string, unknown> = { ...md.frontmatter };
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

    const rootMd = loadMarkdownFile(resolved);
    const fileHashes: Record<string, string> = { [resolved]: rootMd.sha256 };
    const rootFm = { ...rootMd.frontmatter };

    const agentsDirPath = resolveAgentsDir(resolved, rootFm, agentsDir);

    const { agentConfigs, fileHashes: agentHashes } = loadAgents(agentsDirPath);
    Object.assign(fileHashes, agentHashes);

    const configData = buildConfigDataFromYaml(rootFm, agentConfigs);

    const config = buildAgentsConfig(configData);
    return { config, fileHashes };
}
