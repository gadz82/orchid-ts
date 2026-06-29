import { OrchidAgent, getRunContext } from "../core/index.js";
import type {
    OrchidAuthContext,
    OrchidAgentState,
    OrchidVectorReader,
    ChatModelLike,
    ConversationMessage,
} from "../core/index.js";
import type { OrchidAgentConfig } from "../config/schema/index.js";
import type { OrchidMCPToolCaller } from "../core/index.js";
import type { OrchidGraphStore } from "../core/index.js";
import { OrchidRAGScope, makeScope } from "../core/index.js";
import { extractConversationHistory, extractUserQuery } from "../core/index.js";
import type { OrchidQueryTransformer } from "../core/index.js";

import { MCPDispatcher, type MCPCapabilities } from "./mcpDispatcher.js";
import { SystemPromptBuilder } from "./promptBuilder.js";
import { RagPipeline } from "./ragPipeline.js";
import { SkillDetector } from "./skillDetector.js";
import { SkillExecutor } from "./skillExecutor.js";

export class GenericAgent extends OrchidAgent {
    private config: OrchidAgentConfig;
    private agentPeers: Record<string, unknown> = {};
    private mySummaryConfig: Record<string, unknown> | null = null;
    private skillDetector: SkillDetector | null = null;
    private mcpDispatcher: MCPDispatcher;
    private skillExecutor: SkillExecutor;
    private ragPipeline: RagPipeline;
    private promptBuilder: SystemPromptBuilder;

    constructor(opts: {
        config: OrchidAgentConfig;
        reader: OrchidVectorReader;
        mcpClients?: OrchidMCPToolCaller[] | null;
        agentPeers?: Record<string, unknown> | null;
        chatModel?: ChatModelLike | null;
        summaryConfig?: Record<string, unknown> | null;
        graphStore?: OrchidGraphStore | null;
    }) {
        super({
            reader: opts.reader,
            mcpClients: opts.mcpClients ?? undefined,
            chatModel: opts.chatModel ?? undefined,
            graphStore: opts.graphStore ?? undefined,
        });
        this.config = opts.config;
        this.agentPeers = opts.agentPeers ?? {};
        this.mySummaryConfig = opts.summaryConfig ?? null;

        if (opts.chatModel) {
            this.skillDetector = new SkillDetector(opts.chatModel);
        }

        this.mcpDispatcher = new MCPDispatcher(
            (opts.mcpClients ?? []) as any[],
            opts.config.mcpServers ?? [],
        );
        this.skillExecutor = new SkillExecutor({
            agentName: opts.config.name,
            mcpDispatcher: this.mcpDispatcher,
            builtinToolCaller: this.callBuiltinTool.bind(this),
            agentPeers: this.agentPeers,
            contentSources: this._contentSources,
            maxSkillDepth: (opts.config as any).maxSkillDepth ?? 3,
        });
        this.ragPipeline = new RagPipeline({
            reader: opts.reader,
            chatModel: opts.chatModel ?? null,
            graphStore: opts.graphStore ?? null,
        });
        this.promptBuilder = new SystemPromptBuilder((opts.config as any).promptSections ?? {});
    }

    get name(): string {
        return this.config.name;
    }

    get description(): string {
        return (this.config as any).description ?? "";
    }

    get ragNamespace(): string {
        return (this.config.rag as any)?.namespace ?? "";
    }

    needsPeerWiring(): boolean {
        for (const skill of Object.values((this.config as any).skills ?? {})) {
            for (const step of (skill as any).steps ?? []) {
                if (step.agent) return true;
            }
        }
        return false;
    }

    wirePeers(peers: Record<string, unknown>): void {
        this.agentPeers = peers;
        (this.skillExecutor as any)._agentPeers = peers;
    }

    async run(state: OrchidAgentState): Promise<OrchidAgentState> {
        const ctx = getRunContext();
        const auth: OrchidAuthContext | null = ctx.auth;
        if (!auth) {
            return {
                messages: [{ content: `[${this.name}] Error: no auth context`, role: "assistant" }],
                mcpContext: {},
                ragContext: {},
            } as unknown as OrchidAgentState;
        }

        const rawQuery = extractUserQuery(state);

        const transformerNames = ((this.config.rag as any)?.retrieval?.queryTransformers ??
            []) as string[];
        const promptsCfg = (this.config.rag as any)?.retrieval?.transformerPrompts;

        // Filter to pre_strategy transformers only
        const preTransformers: OrchidQueryTransformer[] = [];
        for (const name of transformerNames) {
            try {
                const { TRANSFORMER_REGISTRY, getQueryTransformer, resolveTransformerKwargs } =
                    await import("../rag/transformers/index.js");
                const registryEntry = TRANSFORMER_REGISTRY[name] as any;
                if (registryEntry && registryEntry.preStrategy) {
                    preTransformers.push(
                        getQueryTransformer(
                            name,
                            resolveTransformerKwargs(name, promptsCfg ?? {}),
                        ) as OrchidQueryTransformer,
                    );
                }
            } catch {
                // Module may not be available
            }
        }

        let query = rawQuery;
        if (preTransformers.length > 0 && this._chatModel) {
            const history = extractConversationHistory(state, {
                maxTurns: 5,
                maxChars: 500,
                truncationStrategy: this.getTruncationStrategy(),
            });
            query = await this.applyPreTransformers(
                preTransformers,
                rawQuery,
                this._chatModel,
                history,
            );
        } else {
            // When no pre-transformers are configured, still enrich
            // short follow-up queries with recent conversation context
            // so tools can resolve references (e.g. "profilo psicologico?"
            // should link back to "parlami di lebron james").
            if (rawQuery.length < 80) {
                const recentHistory = extractConversationHistory(state, {
                    maxTurns: 2,
                    maxChars: 300,
                    skipPrefixes: ["[Supervisor"],
                });
                if (recentHistory.length > 0) {
                    const contextStr = recentHistory
                        .map((m) => `${m.role}: ${m.content}`)
                        .join(" | ");
                    query = `${rawQuery}\n(Prior conversation context: ${contextStr})`;
                }
            }
        }

        const scope = this.buildScope(auth, state);
        const ragData = await this.stepRagRetrieval(query, scope);
        const cachedTools = await this.stepCacheCheck(scope);

        let skillName: string | null = null;
        const skills = (this.config as any).skills;
        if (skills && Object.keys(skills).length > 0 && this.skillDetector) {
            skillName = await this.skillDetector.detect(query, skills);
        }

        let mcpData: Record<string, unknown> = {};
        let finalText: string | null = null;
        const loopEvents: any[] = [];

        if (skillName) {
            console.info(`[${this.name}] Running agent skill '${skillName}'`);
            const skill = skills[skillName];
            loopEvents.push({
                _event: "skill.adopted",
                agent: this.name,
                skill: skillName,
                _timestamp: Date.now(),
            });
            mcpData = await this.skillExecutor.runSkill(skillName, skill.steps ?? [], query, auth);
        } else {
            const result = await this.agenticToolLoop(query, auth, state, ragData, {
                skipTools: new Set(Object.keys(cachedTools)),
                contentSources: this._contentSources,
            });
            finalText = result.finalText;
            mcpData = result.toolResults;
            loopEvents.push(...result.events);

            if (Object.keys(cachedTools).length > 0) {
                mcpData = { ...cachedTools, ...mcpData };
            }
        }

        await this.stepDynamicInjection(mcpData, scope);

        let summary: string;
        if (finalText) {
            summary = finalText;
        } else {
            summary = await this.stepSummarise(query, mcpData, ragData, state);
        }

        await this.storeAgentTurn(state, summary);

        const content = `[${this.titleCase(this.name)} Agent]\n${summary}`;
        const outputMessages: any[] = loopEvents.filter(Boolean);
        outputMessages.push({ content, role: "assistant" });

        return {
            messages: outputMessages as any,
            mcpContext: { [this.name]: mcpData },
            ragContext: { [this.name]: ragData },
        } as unknown as OrchidAgentState;
    }

    private async applyPreTransformers(
        transformers: OrchidQueryTransformer[],
        query: string,
        chatModel: ChatModelLike,
        _history: ConversationMessage[],
    ): Promise<string> {
        let cur = query;
        for (const t of transformers) {
            try {
                const results = await t.transform(cur, chatModel);
                if (results.length > 0) cur = results[0];
            } catch (e) {
                console.warn(
                    `[${this.name}] Pre-strategy transformer '${t.name}' failed: ${String(e)}`,
                );
            }
        }
        return cur;
    }

    private getTruncationStrategy(): string {
        return (this.mySummaryConfig as any)?.truncationStrategy ?? "hard";
    }

    private async storeAgentTurn(state: OrchidAgentState | null, response: string): Promise<void> {
        if (!state || !this.mySummaryConfig) return;
        const memory = (this.mySummaryConfig as any).memory;
        if (!memory || typeof memory.storeConversationTurn !== "function") return;
        try {
            const chatId = (state as any).chatId ?? (state as any).chat_id ?? "";
            if (!chatId) return;
            const ctx = getRunContext();
            const auth = ctx.auth;
            const tenantId = auth?.tenantKey ?? "default";
            const userId = auth?.userId ?? "";
            const query = extractUserQuery(state);
            if (query) {
                await memory.storeConversationTurn(
                    chatId,
                    tenantId,
                    userId,
                    { role: "user", content: query },
                    { turnType: "agent", agent: this.name },
                );
            }
            if (response) {
                await memory.storeConversationTurn(
                    chatId,
                    tenantId,
                    userId,
                    { role: "assistant", content: response },
                    { turnType: "agent", agent: this.name },
                );
            }
        } catch {
            // Silently ignore memory store failures
        }
    }

    private buildScope(auth: OrchidAuthContext, state: OrchidAgentState): OrchidRAGScope {
        return makeScope({
            tenantId: auth.tenantKey,
            userId: auth.userId,
            chatId: (state as any).chatId ?? (state as any).chat_id ?? "",
            agentId: this.name,
        });
    }

    private async stepRagRetrieval(
        query: string,
        scope: OrchidRAGScope,
    ): Promise<Array<Record<string, unknown>>> {
        return await this.ragPipeline.retrieve({
            query,
            scope,
            ragNamespace: this.ragNamespace,
            k: (this.config.rag as any)?.k ?? 5,
            enabled: (this.config.rag as any)?.enabled ?? true,
            retrievalStrategy: (this.config.rag as any)?.retrieval?.strategy ?? "simple",
            retrievalConfig: (this.config.rag as any)?.retrieval ?? null,
            excludeDynamic: (this.config.rag as any)?.retrieval?.excludeDynamic ?? false,
        });
    }

    private async stepCacheCheck(scope: OrchidRAGScope): Promise<Record<string, unknown>> {
        return await this.ragPipeline.checkCache({
            scope,
            ragNamespace: (this.config.rag as any)?.namespace ?? "",
            enabled: (this.config.rag as any)?.enabled ?? true,
            toolTtls: (this.config as any).injectableToolTtls ?? null,
        });
    }

    private async stepDynamicInjection(
        mcpData: Record<string, unknown>,
        scope: OrchidRAGScope,
    ): Promise<void> {
        await this.ragPipeline.inject({
            mcpData,
            scope,
            ragNamespace: (this.config.rag as any)?.namespace ?? "",
            enabled: (this.config.rag as any)?.enabled ?? true,
            injectableTools: (this.config as any).injectableTools ?? null,
            effectiveRagResolver: (this.config as any).effectiveRag?.bind?.(this.config) ?? null,
        });
    }

    private async stepSummarise(
        query: string,
        mcpData: Record<string, unknown>,
        ragData: Array<Record<string, unknown>>,
        state: OrchidAgentState | null,
    ): Promise<string> {
        const llmConfig = (this.config as any).llm;

        let history: ConversationMessage[] = [];
        if (state) {
            history = extractConversationHistory(state, {
                stripPrefixes: this.computeAgentPrefixes(),
                truncationStrategy: this.getTruncationStrategy(),
            }) as unknown as ConversationMessage[];
        }

        if (history.length > 0 && this.mySummaryConfig && this._chatModel) {
            let runningSummary: string | null = null;
            const memory = (this.mySummaryConfig as any).memory;
            if (memory && state) {
                const chatId = (state as any).chatId ?? (state as any).chat_id ?? "";
                if (chatId) {
                    try {
                        runningSummary = await memory.getRunningSummary(chatId);
                    } catch {
                        // Ignore
                    }
                }
            }
            history = await OrchidAgent.compressConversationHistory(history, this._chatModel, {
                recentTurns: (this.mySummaryConfig as any).recentTurns ?? 3,
                runningSummary: runningSummary ?? undefined,
                structuredOutput: (this.mySummaryConfig as any).structuredOutput ?? false,
            });

            if (memory && runningSummary && state) {
                const chatId = (state as any).chatId ?? (state as any).chat_id ?? "";
                if (chatId) {
                    try {
                        await memory.updateRunningSummary(chatId, history, runningSummary);
                    } catch {
                        // Ignore
                    }
                }
            }
        }

        const priorCtx = state ? ((state as any).mcpContext ?? {})[this.name] : null;
        const sections = (this.config as any).promptSections ?? {};

        const kwargs: Record<string, unknown> = {
            systemPrompt: this.config.prompt ?? "",
            conversationHistory: history.length > 0 ? history : undefined,
            priorToolContext: priorCtx ?? undefined,
        };
        if ((sections as any).summariseHistoryReminder)
            kwargs.historyReminder = (sections as any).summariseHistoryReminder;
        if ((sections as any).summarisePriorResultsHeader)
            kwargs.priorResultsHeader = (sections as any).summarisePriorResultsHeader;
        if ((sections as any).summariseRagSectionHeader)
            kwargs.ragSectionHeader = (sections as any).summariseRagSectionHeader;
        if ((sections as any).summariseUserTemplate)
            kwargs.userContentTemplate = (sections as any).summariseUserTemplate;
        if ((sections as any).summarisePriorResultsMaxChars)
            kwargs.priorResultsMaxChars = (sections as any).summarisePriorResultsMaxChars;

        const temperature = llmConfig?.temperature ?? 0.2;
        kwargs.temperature = temperature;

        return await this.summarise(
            query,
            mcpData,
            ragData as unknown as Record<string, unknown>,
            kwargs as any,
        );
    }

    private computeAgentPrefixes(): string[] {
        const prefixes = [`[${this.titleCase(this.name)} Agent]\n`];
        for (const peerName of Object.keys(this.agentPeers)) {
            prefixes.push(`[${this.titleCase(peerName)} Agent]\n`);
        }
        return prefixes;
    }

    private async agenticToolLoop(
        query: string,
        auth: OrchidAuthContext,
        state: OrchidAgentState | null,
        ragData: Array<Record<string, unknown>>,
        opts: {
            skipTools?: Set<string>;
            contentSources?: unknown;
        } = {},
    ): Promise<{ finalText: string | null; toolResults: Record<string, unknown>; events: any[] }> {
        const { AgenticLoop } = await import("./agenticLoop.js");
        const { buildLangChainTools } = await import("./tools.js");

        const llmConfig = (this.config as any).llm;
        if (!this._chatModel) {
            return { finalText: null, toolResults: {}, events: [] };
        }

        const caps = await this.mcpDispatcher.renderCapabilities(auth, { agentName: this.name });

        const { names: builtinNames, defs: builtinDefs } = await this.builtinToolsToLiteLLM(
            opts.skipTools,
        );
        const mcpDefs = MCPDispatcher.mcpToolsToLiteLLM(
            caps.rawTools.filter(
                (t: any) =>
                    !builtinNames.has(t.name) && !(opts.skipTools && opts.skipTools.has(t.name)),
            ),
        );

        const allToolDefs = [...mcpDefs, ...builtinDefs];
        if (allToolDefs.length === 0) {
            return { finalText: null, toolResults: {}, events: [] };
        }

        const clientMap = new Map<string, { client: any; serverConfig: any }>();
        for (const [name, [client, config]] of caps.toolClientMap) {
            clientMap.set(name, { client, serverConfig: config });
        }

        const lcTools = buildLangChainTools({
            builtinNames,
            builtinToolDefs: builtinDefs,
            mcpToolDefs: mcpDefs,
            mcpToolClientMap: clientMap,
            auth,
            agentName: this.name,
            approvalTools: (this.config as any).approvalTools ?? null,
            contentSources: opts.contentSources,
        });

        const toolMap = new Map<string, any>();
        for (const t of lcTools) {
            toolMap.set(t.name, t);
        }

        const systemPrompt = this.buildAgenticSystemPrompt(caps, ragData, state);
        const messages: any[] = [{ role: "system", content: systemPrompt }];

        if (state) {
            messages.push(
                ...extractConversationHistory(state, {
                    stripPrefixes: this.computeAgentPrefixes(),
                    truncationStrategy: this.getTruncationStrategy(),
                }),
            );
        }
        messages.push({ role: "user", content: query });

        const parallelSafety = await this.resolveParallelSafety(toolMap, builtinNames, caps);

        const loop = new AgenticLoop({
            agentName: this.name,
            chatModel: this._chatModel,
            toolMap,
            allToolDefs,
            temperature: llmConfig?.temperature ?? 0.2,
            parallelSafety,
            maxToolRounds: (this.config as any).maxToolRounds ?? 15,
            maxConsecutiveDupes: (this.config as any).maxConsecutiveDupes ?? 2,
        });

        const [finalText, toolResults] = await loop.run(messages);
        return { finalText, toolResults, events: loop.events };
    }

    private async resolveParallelSafety(
        toolMap: Map<string, any>,
        builtinNames: Set<string>,
        caps: MCPCapabilities,
    ): Promise<Record<string, boolean> | null> {
        const { resolveParallelSafety } = await import("./toolUtils.js");
        return resolveParallelSafety({
            toolMap,
            builtinToolNames: builtinNames,
            caps,
            parallelToolsEnabled: !!(this.config as any).parallelTools,
            approvalTools: (this.config as any).approvalTools,
            parallelSafeBuiltinTools: (this.config as any).parallelSafeBuiltinTools,
            mcpParallelOverrides: this.mcpParallelOverrides(),
        });
    }

    private mcpParallelOverrides(): Record<string, boolean> {
        const overrides: Record<string, boolean> = {};
        for (const server of this.config.mcpServers ?? []) {
            for (const tool of server.tools ?? []) {
                if (
                    (tool as any).parallelSafe !== undefined &&
                    (tool as any).parallelSafe !== null
                ) {
                    overrides[tool.name] = !!(tool as any).parallelSafe;
                }
            }
        }
        return overrides;
    }

    private buildAgenticSystemPrompt(
        caps: MCPCapabilities,
        ragData: Array<Record<string, unknown>>,
        state: OrchidAgentState | null,
    ): string {
        return this.promptBuilder.build(this.config.prompt ?? "", {
            caps,
            ragData,
            state: state as any,
            agentName: this.name,
            ragMaxContextChars: (this.config.rag as any)?.maxContextChars ?? 3000,
        });
    }

    private async builtinToolsToLiteLLM(skipTools?: Set<string>): Promise<{
        names: Set<string>;
        defs: any[];
    }> {
        const { toolsToLiteLLMFormat } = await import("./toolUtils.js");
        return toolsToLiteLLMFormat(this.config.tools ?? [], { skipTools });
    }

    private titleCase(s: string): string {
        if (!s) return s;
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
}
