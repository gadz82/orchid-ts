import { z } from "zod";
import { OrchidMCPGatewayConfigSchema } from "./mcpGateway.js";
import { OrchidEventsConfigSchema } from "./events.js";
import { OrchidConfigStorageConfigSchema } from "./storage.js";
import { OrchidGuardrailsConfigSchema } from "./guardrails.js";
import { OrchidLLMConfigSchema } from "./llm.js";
import { OrchidMCPServerConfigSchema } from "./mcp.js";
import { OrchidMiniAgentConfigSchema } from "./miniAgent.js";
import { OrchidAgentPromptConfigSchema } from "./prompts.js";
import { OrchidRAGConfigSchema, OrchidRAGDefaultsConfigSchema } from "./rag.js";
import {
    OrchidAgentSkillConfigSchema,
    OrchidBuiltinToolConfigSchema,
    OrchidOrchestratorSkillConfigSchema,
} from "./skills.js";
import { ExecutionHintsSchema, OrchidSupervisorConfigSchema } from "./supervisor.js";

export const OrchidAgentConfigSchema: z.ZodTypeAny = z.object({
    name: z.string().default(""),
    description: z.string(),
    prompt: z.string(),
    class: z.string().nullable().default(null),
    rag: OrchidRAGConfigSchema.default({}),
    mcpServers: z.array(OrchidMCPServerConfigSchema).default([]),
    llm: OrchidLLMConfigSchema.nullable().default(null),
    executionHints: ExecutionHintsSchema.default({}),
    tools: z.array(z.string()).default([]),
    skills: z.record(z.string(), OrchidAgentSkillConfigSchema).default({}),
    guardrails: OrchidGuardrailsConfigSchema.default({}),
    children: z
        .record(
            z.string(),
            z.lazy(() => OrchidAgentConfigSchema),
        )
        .nullable()
        .default(null),
    parallelTools: z.boolean().default(false),
    maxToolRounds: z.number().int().min(1).max(100).default(15),
    maxConsecutiveDupes: z.number().int().min(1).max(10).default(2),
    maxSkillDepth: z.number().int().min(1).max(10).default(3),
    miniAgent: OrchidMiniAgentConfigSchema.default({}),
    promptSections: OrchidAgentPromptConfigSchema.default({}),
});

export type OrchidAgentConfig = z.infer<typeof OrchidAgentConfigSchema>;

export const OrchidDefaultsConfigSchema = z.object({
    llm: OrchidLLMConfigSchema.default({}),
    rag: OrchidRAGDefaultsConfigSchema.default({}),
    cacheEnabled: z.boolean().default(false),
});

export type OrchidDefaultsConfig = z.infer<typeof OrchidDefaultsConfigSchema>;

export const OrchidAgentsConfigSchema = z.object({
    version: z.string().default("1"),
    defaults: OrchidDefaultsConfigSchema.default({}),
    tools: z.record(z.string(), OrchidBuiltinToolConfigSchema).default({}),
    skills: z.record(z.string(), OrchidOrchestratorSkillConfigSchema).default({}),
    supervisor: OrchidSupervisorConfigSchema.default({}),
    guardrails: OrchidGuardrailsConfigSchema.default({}),
    mcpGateway: OrchidMCPGatewayConfigSchema.default({}),
    agents: z.record(z.string(), OrchidAgentConfigSchema).default({}),
    allowedPassthroughHosts: z.array(z.string()).default([]),
    events: OrchidEventsConfigSchema.nullable().default(null),
    configStorage: OrchidConfigStorageConfigSchema.default({}),
    startupHooks: z.array(z.string()).default([]),
});

export type OrchidAgentsConfig = z.infer<typeof OrchidAgentsConfigSchema>;

// ── Defaults merging ──────────────────────────────────────────────

function deepMerge(
    base: Record<string, unknown>,
    overlay: Record<string, unknown>,
): Record<string, unknown> {
    const result = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        if (
            key in result &&
            result[key] !== null &&
            typeof result[key] === "object" &&
            !Array.isArray(result[key]) &&
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        ) {
            result[key] = deepMerge(
                result[key] as Record<string, unknown>,
                value as Record<string, unknown>,
            );
        } else {
            result[key] = value;
        }
    }
    return result;
}

function inheritField(
    agent: Record<string, unknown>,
    defaults: Record<string, unknown>,
    fieldName: string,
): void {
    if (!(fieldName in agent) || agent[fieldName] === undefined || agent[fieldName] === null) {
        if (
            fieldName in defaults &&
            defaults[fieldName] !== undefined &&
            defaults[fieldName] !== null
        ) {
            agent[fieldName] = defaults[fieldName];
        }
    }
}

function mergeRetrievalDefaults(
    agent: Record<string, unknown>,
    defaults: Record<string, unknown>,
): void {
    const r = (agent.rag as Record<string, unknown>)?.retrieval as
        | Record<string, unknown>
        | undefined;
    const dr = (defaults.rag as Record<string, unknown>)?.retrieval as
        | Record<string, unknown>
        | undefined;
    if (!r || !dr) return;

    if (!r.strategy) r.strategy = dr.strategy || "simple";
    if (!r.queryTransformers)
        r.queryTransformers = (dr.queryTransformers as unknown[])?.slice() ?? [];

    const rFilters = r.metadataFilters as Record<string, unknown> | undefined;
    const drFilters = dr.metadataFilters as Record<string, unknown> | undefined;
    if (
        (!rFilters || Object.keys(rFilters).length === 0) &&
        drFilters &&
        Object.keys(drFilters).length > 0
    ) {
        r.metadataFilters = { ...drFilters };
    }

    // Merge transformer prompts
    const tp = r.transformerPrompts as Record<string, unknown> | undefined;
    const dtp = dr.transformerPrompts as Record<string, unknown> | undefined;
    if (tp && dtp) {
        if (!tp.multiQuery && dtp.multiQuery) tp.multiQuery = dtp.multiQuery;
        if (!tp.decompose && dtp.decompose) tp.decompose = dtp.decompose;
        if (!tp.reformulate && dtp.reformulate) tp.reformulate = dtp.reformulate;
        const hyde = tp.hyde as Record<string, unknown> | undefined;
        const dHyde = dtp.hyde as Record<string, unknown> | undefined;
        if (hyde && dHyde) {
            if (!hyde.single && dHyde.single) hyde.single = dHyde.single;
            if (!hyde.multi && dHyde.multi) hyde.multi = dHyde.multi;
        }
    }
}

function mergeIngestionDefaults(
    agent: Record<string, unknown>,
    defaults: Record<string, unknown>,
): void {
    const i = (agent.rag as Record<string, unknown>)?.ingestion as
        | Record<string, unknown>
        | undefined;
    const di = (defaults.rag as Record<string, unknown>)?.ingestion as
        | Record<string, unknown>
        | undefined;
    if (!i || !di) return;

    if (!i.strategy) i.strategy = di.strategy || "recursive";
    inheritField(i, di, "chunkSize");
    inheritField(i, di, "chunkOverlap");
    inheritField(i, di, "parentChunkSize");
    inheritField(i, di, "parentChunkOverlap");

    const iPost = i.postProcessors as string[] | undefined;
    const diPost = di.postProcessors as string[] | undefined;
    if ((!iPost || iPost.length === 0) && diPost && diPost.length > 0) {
        i.postProcessors = [...diPost];
    }
}

function mergeLLMDefaults(agent: Record<string, unknown>, defaults: Record<string, unknown>): void {
    if (!agent.llm) {
        agent.llm = { ...(defaults.llm as Record<string, unknown>) };
    }
}

function mergeRAGDefaults(agent: Record<string, unknown>, defaults: Record<string, unknown>): void {
    const rag = agent.rag as Record<string, unknown>;
    const dRag = defaults.rag as Record<string, unknown>;
    if (!rag || !dRag) return;

    inheritField(rag, dRag, "k");
    inheritField(rag, dRag, "enabled");
    inheritField(rag, dRag, "ragTtl");
    if (rag.maxContextChars == null) {
        rag.maxContextChars = dRag.maxContextChars;
    }
}

function collectInjectableTools(
    agent: Record<string, unknown>,
    globalTools: Record<string, unknown> | null,
): { injectableTools: string[]; injectableToolTtls: Record<string, number> } {
    const injectableTools: string[] = [];
    const injectableToolTtls: Record<string, number> = {};
    const agentTtl = ((agent.rag as Record<string, unknown>)?.ragTtl as number) ?? 0;

    const mcpServers = agent.mcpServers as Array<Record<string, unknown>> | undefined;
    if (mcpServers) {
        for (const server of mcpServers) {
            const tools = server.tools as Array<Record<string, unknown>> | undefined;
            if (tools) {
                for (const tool of tools) {
                    if (tool.injectToRag) {
                        injectableTools.push(tool.name as string);
                        const effectiveTtl = (tool.ragTtl as number | null) ?? agentTtl;
                        if (effectiveTtl > 0) {
                            injectableToolTtls[tool.name as string] = effectiveTtl;
                        }
                    }
                }
            }
        }
    }

    if (globalTools) {
        const agentToolNames = agent.tools as string[] | undefined;
        if (agentToolNames) {
            for (const toolName of agentToolNames) {
                const toolCfg = globalTools[toolName] as Record<string, unknown> | undefined;
                if (toolCfg && toolCfg.injectToRag) {
                    const key = `builtin_${toolName}`;
                    injectableTools.push(key);
                    const effectiveTtl = (toolCfg.ragTtl as number | null) ?? agentTtl;
                    if (effectiveTtl > 0) {
                        injectableToolTtls[key] = effectiveTtl;
                    }
                }
            }
        }
    }

    return { injectableTools, injectableToolTtls };
}

function collectApprovalTools(
    agent: Record<string, unknown>,
    globalTools: Record<string, unknown> | null,
): string[] {
    const approvalTools: string[] = [];

    const mcpServers = agent.mcpServers as Array<Record<string, unknown>> | undefined;
    if (mcpServers) {
        for (const server of mcpServers) {
            const tools = server.tools as Array<Record<string, unknown>> | undefined;
            if (tools) {
                for (const tool of tools) {
                    if (tool.requiresApproval) {
                        approvalTools.push(tool.name as string);
                    }
                }
            }
        }
    }

    if (globalTools) {
        const agentToolNames = agent.tools as string[] | undefined;
        if (agentToolNames) {
            for (const toolName of agentToolNames) {
                const toolCfg = globalTools[toolName] as Record<string, unknown> | undefined;
                if (toolCfg && toolCfg.requiresApproval) {
                    approvalTools.push(toolName);
                }
            }
        }
    }

    return approvalTools;
}

function collectParallelSafeTools(
    agent: Record<string, unknown>,
    globalTools: Record<string, unknown> | null,
): string[] {
    const safe: string[] = [];
    if (globalTools) {
        const agentToolNames = agent.tools as string[] | undefined;
        if (agentToolNames) {
            for (const toolName of agentToolNames) {
                const toolCfg = globalTools[toolName] as Record<string, unknown> | undefined;
                if (toolCfg && toolCfg.parallelSafe === true) {
                    safe.push(toolName);
                }
            }
        }
    }
    return safe;
}

function cacheBuiltinToolConfigs(
    agent: Record<string, unknown>,
    globalTools: Record<string, unknown> | null,
): Record<string, unknown> {
    const configs: Record<string, unknown> = {};
    if (globalTools) {
        const agentToolNames = agent.tools as string[] | undefined;
        if (agentToolNames) {
            for (const toolName of agentToolNames) {
                const toolCfg = globalTools[toolName];
                if (toolCfg !== undefined) {
                    configs[toolName] = toolCfg;
                }
            }
        }
    }
    return configs;
}

function applyDefaults(
    agent: Record<string, unknown>,
    name: string,
    defaults: Record<string, unknown>,
    globalTools: Record<string, unknown> | null = null,
): void {
    agent.name = name;

    mergeLLMDefaults(agent, defaults);
    mergeRAGDefaults(agent, defaults);
    mergeRetrievalDefaults(agent, defaults);
    mergeIngestionDefaults(agent, defaults);

    const { injectableTools, injectableToolTtls } = collectInjectableTools(agent, globalTools);
    (agent as Record<string, unknown>).injectableTools = injectableTools;
    (agent as Record<string, unknown>).injectableToolTtls = injectableToolTtls;
    (agent as Record<string, unknown>).approvalTools = collectApprovalTools(agent, globalTools);
    (agent as Record<string, unknown>).parallelSafeBuiltinTools = collectParallelSafeTools(
        agent,
        globalTools,
    );
    (agent as Record<string, unknown>).builtinToolConfigs = cacheBuiltinToolConfigs(
        agent,
        globalTools,
    );

    // Recurse into children
    const children = agent.children as Record<string, Record<string, unknown>> | null | undefined;
    if (children) {
        for (const [childName, child] of Object.entries(children)) {
            const miniAgent = child.miniAgent as Record<string, unknown> | undefined;
            if (miniAgent?.enabled) {
                throw new Error(
                    `agent '${name}.${childName}' has mini_agent.enabled=true — ` +
                        `mini-agents may only be enabled on top-level agents (no nesting).`,
                );
            }
            applyDefaults(child, childName, defaults, globalTools);
        }
    }
}

// ── Effective RAG ────────────────────────────────────────────────

export function effectiveRag(
    agent: OrchidAgentConfig,
    toolName: string,
): z.infer<typeof OrchidRAGConfigSchema> {
    let toolRag: z.infer<typeof OrchidRAGConfigSchema> | null = null;

    for (const server of agent.mcpServers) {
        for (const tool of server.tools) {
            if (tool.name === toolName && tool.rag !== null) {
                toolRag = tool.rag;
                break;
            }
        }
        if (toolRag !== null) break;
    }

    if (toolRag === null) {
        const builtin = (agent as Record<string, unknown>).builtinToolConfigs as
            | Record<string, unknown>
            | undefined;
        const builtinCfg = builtin?.[toolName] as Record<string, unknown> | undefined;
        if (builtinCfg?.rag) {
            toolRag = builtinCfg.rag as z.infer<typeof OrchidRAGConfigSchema>;
        }
    }

    if (toolRag === null) {
        return agent.rag;
    }

    // Deep-merge tool RAG onto agent RAG
    const base = agent.rag as unknown as Record<string, unknown>;
    const overlay = toolRag as unknown as Record<string, unknown>;
    const merged = deepMerge(base, overlay);
    return merged as unknown as z.infer<typeof OrchidRAGConfigSchema>;
}

// ── Pre-apply raw YAML defaults (before zod parsing) ────────────
//
// Zod schemas set their own defaults for every field (e.g. rag.enabled
// defaults to true).  If we parse first and then try to apply YAML
// defaults with inheritField(), the zod defaults shadow the YAML values
// because the fields are already populated.  We fix this by merging raw
// YAML defaults into the raw agent data BEFORE zod ever sees it.  This
// way agents that don't explicitly set a field get the YAML default, and
// zod only fills in what's still missing.

function preApplyRawDefaults(rawData: Record<string, unknown>): void {
    const rawDefaults = rawData.defaults as Record<string, unknown> | undefined;
    const rawAgents = rawData.agents as Record<string, Record<string, unknown>> | undefined;
    if (!rawDefaults || !rawAgents) return;

    const rawRag = rawDefaults.rag as Record<string, unknown> | undefined;
    if (rawRag) {
        for (const agent of Object.values(rawAgents)) {
            _preApplyRagDefaults(agent, rawRag);
        }
    }

    const rawLlm = rawDefaults.llm as Record<string, unknown> | undefined;
    if (rawLlm) {
        for (const agent of Object.values(rawAgents)) {
            _preApplyLlmDefaults(agent, rawLlm);
        }
    }
}

function _preApplyRagDefaults(agent: Record<string, unknown>, rawRag: Record<string, unknown>): void {
    if (!agent.rag || typeof agent.rag !== "object") {
        agent.rag = { ...rawRag };
    } else {
        const aRag = agent.rag as Record<string, unknown>;
        for (const [key, value] of Object.entries(rawRag)) {
            if (!(key in aRag) || aRag[key] === undefined || aRag[key] === null) {
                aRag[key] = value;
            }
        }
    }

    const children = agent.children as Record<string, Record<string, unknown>> | undefined;
    if (children) {
        for (const child of Object.values(children)) {
            _preApplyRagDefaults(child, rawRag);
        }
    }
}

function _preApplyLlmDefaults(agent: Record<string, unknown>, rawLlm: Record<string, unknown>): void {
    if (!agent.llm || typeof agent.llm !== "object") {
        agent.llm = { ...rawLlm };
    }

    const children = agent.children as Record<string, Record<string, unknown>> | undefined;
    if (children) {
        for (const child of Object.values(children)) {
            _preApplyLlmDefaults(child, rawLlm);
        }
    }
}

// ── Build config with defaults applied ──────────────────────────

export function buildAgentsConfig(rawData: Record<string, unknown>): OrchidAgentsConfig {
    preApplyRawDefaults(rawData);

    const parsed = OrchidAgentsConfigSchema.parse(rawData) as Record<string, unknown>;
    const config: OrchidAgentsConfig = parsed as unknown as OrchidAgentsConfig;

    // Apply defaults and names recursively
    const defaultObj = config.defaults as unknown as Record<string, unknown>;
    const toolsObj = config.tools as unknown as Record<string, unknown>;

    for (const [agentName, agent] of Object.entries(config.agents as Record<string, unknown>)) {
        applyDefaults(agent as Record<string, unknown>, agentName, defaultObj, toolsObj);
    }

    return config;
}

// ── Merge from DB ──────────────────────────────────────────────

export function mergeFromDb(
    config: OrchidAgentsConfig,
    dbConfigs: Array<{ name: string; config: Record<string, unknown> }>,
    strict = true,
): void {
    if (strict) {
        const yamlNames = new Set(Object.keys(config.agents));
        const dbNames = new Set(dbConfigs.map((r) => r.name));
        const overlap = [...yamlNames].filter((n) => dbNames.has(n));
        if (overlap.length > 0) {
            throw new Error(
                `Agent(s) defined in both YAML and DB: ${overlap.sort().join(", ")}. Remove from YAML or DB to proceed.`,
            );
        }
    }

    for (const row of dbConfigs) {
        const { name, config: cfgDict } = row;
        if (name in config.agents) {
            const existing = config.agents[name] as unknown as Record<string, unknown>;
            const merged = deepMerge(existing, cfgDict);
            (config.agents as Record<string, unknown>)[name] =
                OrchidAgentConfigSchema.parse(merged);
        } else {
            (config.agents as Record<string, unknown>)[name] =
                OrchidAgentConfigSchema.parse(cfgDict);
        }
    }
}
