import type { GraphState } from "./state.js";
import { createSupervisorNode, routeToAgents } from "./supervisor.js";
import { GuardrailWiring } from "./guardrailWiring.js";
import { MiniAgentWiring } from "./miniAgentWiring.js";
import { LangGraphAdapter } from "./langGraphAdapter.js";
import { OrchidAgent } from "../core/agent.js";
import type { OrchidAuthContext } from "../core/state.js";
import type { OrchidAgentsConfig, OrchidAgentConfig } from "../config/schema/agent.js";
import type { OrchidConversationMemory } from "../core/memory.js";
import {
    OrchidGuardrailAction,
    OrchidGuardrailChain,
    OrchidGuardrailDirection,
} from "../core/guardrails.js";
import type { OrchidGuardrailContext } from "../core/guardrails.js";
import { authFromConfig } from "../core/runConfig.js";
import type { ChatModelLike } from "../core/helpers.js";
import type { OrchidVectorReader } from "../core/repository.js";
import type { OrchidRuntime } from "../orchid/runtime.js";

const END = "__end__";

// ── AgentNodeWrapper ──────────────────────────────────────────────

class AgentNodeWrapper {
    public __name__: string;
    private agent: OrchidAgent;
    private inputGuardrails: OrchidGuardrailChain | null;
    private outputGuardrails: OrchidGuardrailChain | null;
    private agentConfig: OrchidAgentConfig | null;

    constructor({
        agent,
        inputGuardrails = null,
        outputGuardrails = null,
        agentConfig = null,
    }: {
        agent: OrchidAgent;
        inputGuardrails?: OrchidGuardrailChain | null;
        outputGuardrails?: OrchidGuardrailChain | null;
        agentConfig?: OrchidAgentConfig | null;
    }) {
        this.agent = agent;
        this.inputGuardrails = inputGuardrails;
        this.outputGuardrails = outputGuardrails;
        this.agentConfig = agentConfig;
        this.__name__ = `${agent.name}_agent`;
    }

    async __call__(
        state: GraphState,
        config?: Record<string, unknown>,
    ): Promise<Partial<GraphState>> {
        const auth = authFromConfig(config);

        const blocked = await this.runInputGuardrails(state, auth);
        if (blocked !== null) return blocked;

        const decomposerUpdate = await this.runDecomposer(state, auth);
        if (decomposerUpdate !== null) {
            decomposerUpdate.activeAgents = [];
            return decomposerUpdate;
        }

        const agentResult = await this.runAgent(state);

        await this.runOutputGuardrails(state, auth, agentResult);

        agentResult.activeAgents = [];
        return agentResult;
    }

    // LangChain Runnable interface — LangGraph's `_coerceToRunnable` checks
    // for `.invoke()` (or `.call()` / `.run()`) on the value passed to
    // `addNode()`. Without this, the AgentNodeWrapper is treated as an
    // "unsupported type" and addNode throws. The `__call__` method above is
    // Python-style and does not make the class instance callable in JS.
    async invoke(
        state: GraphState,
        config?: Record<string, unknown>,
    ): Promise<Partial<GraphState>> {
        return this.__call__(state, config);
    }

    private async runInputGuardrails(
        state: GraphState,
        auth: OrchidAuthContext | null,
    ): Promise<Partial<GraphState> | null> {
        if (!this.inputGuardrails || this.inputGuardrails.empty) return null;

        const query = OrchidAgent.extractUserQuery(state as any);
        const ctx: OrchidGuardrailContext = {
            direction: OrchidGuardrailDirection.INPUT,
            agentName: this.agent.name,
            tenantKey: auth?.tenantKey ?? "default",
            userId: auth?.userId ?? "",
            chatId: state.chatId ?? "",
            metadata: {},
        };
        const result = await this.inputGuardrails.evaluate(query, ctx);
        if (result.blocked) {
            console.warn(
                "[Guardrails] Agent '%s' input blocked by '%s': %s",
                this.agent.name,
                result.guardrailName,
                result.message,
            );
            const agentTitle = this.agent.name.charAt(0).toUpperCase() + this.agent.name.slice(1);
            return {
                messages: [
                    { role: "ai", content: `[${agentTitle} Agent] ${result.message}` },
                ] as unknown[],
                activeAgents: [],
            };
        }
        return null;
    }

    private async runDecomposer(
        state: GraphState,
        auth: OrchidAuthContext | null,
    ): Promise<Partial<GraphState> | null> {
        if (!this.agentConfig || !this.agentConfig.miniAgent.enabled || auth === null) return null;

        try {
            const { maybeDecompose } = await import("../agents/miniAgentDecomposer.js");
            const chatModel = (this.agent as any)._chatModel as ChatModelLike | null;
            if (chatModel === null) return null;
            const mcpClients = ((this.agent as any).mcpClients ?? []) as unknown[];
            return await maybeDecompose({
                agentConfig: this.agentConfig,
                chatModel,
                mcpClients,
                auth,
                state: state as unknown as Record<string, unknown>,
            });
        } catch {
            return null;
        }
    }

    private async runAgent(state: GraphState): Promise<Partial<GraphState>> {
        try {
            const result = await (this.agent as any).run(state);
            return result as Partial<GraphState>;
        } catch (exc: unknown) {
            const errorMsg = String(exc instanceof Error ? exc.message : exc);
            console.error(
                "[Graph] Agent '%s' raised an unhandled exception: %s",
                this.agent.name,
                errorMsg,
            );
            const agentTitle = this.agent.name.charAt(0).toUpperCase() + this.agent.name.slice(1);
            return {
                messages: [
                    {
                        role: "ai",
                        content: `[${agentTitle} Agent] I'm temporarily unable to process your request. Please try again in a few moments.`,
                    },
                ] as unknown[],
            };
        }
    }

    private async runOutputGuardrails(
        state: GraphState,
        auth: OrchidAuthContext | null,
        agentResult: Partial<GraphState>,
    ): Promise<void> {
        if (!this.outputGuardrails || this.outputGuardrails.empty) return;

        const agentMessages = (agentResult.messages ?? []) as Array<Record<string, unknown>>;
        if (agentMessages.length === 0) return;

        const responseText = String(agentMessages[agentMessages.length - 1]["content"] ?? "");
        const ctx: OrchidGuardrailContext = {
            direction: OrchidGuardrailDirection.OUTPUT,
            agentName: this.agent.name,
            tenantKey: auth?.tenantKey ?? "default",
            userId: auth?.userId ?? "",
            chatId: state.chatId ?? "",
            metadata: {
                ragContext:
                    ((agentResult.ragContext ?? {}) as Record<string, unknown>)[this.agent.name] ??
                    [],
            },
        };
        const result = await this.outputGuardrails.evaluate(responseText, ctx);
        if (result.blocked) {
            console.warn(
                "[Guardrails] Agent '%s' output blocked by '%s': %s",
                this.agent.name,
                result.guardrailName,
                result.message,
            );
            const agentTitle = this.agent.name.charAt(0).toUpperCase() + this.agent.name.slice(1);
            agentResult.messages = [
                { role: "ai", content: `[${agentTitle} Agent] ${result.message}` },
            ] as unknown[];
        } else if (
            result.action === OrchidGuardrailAction.REDACT &&
            result.redactedContent != null
        ) {
            console.info(
                "[Guardrails] Agent '%s' output redacted by '%s'",
                this.agent.name,
                result.guardrailName,
            );
            agentResult.messages = [{ role: "ai", content: result.redactedContent }] as unknown[];
        }
    }
}

function createAgentNode(
    agent: OrchidAgent,
    inputGuardrails: OrchidGuardrailChain | null = null,
    outputGuardrails: OrchidGuardrailChain | null = null,
    agentConfig: OrchidAgentConfig | null = null,
): (state: GraphState, config?: Record<string, unknown>) => Promise<Partial<GraphState>> {
    // Return a plain function (not the AgentNodeWrapper class instance) so
    // LangGraph's `_coerceToRunnable` wraps it in `RunnableLambda`. An object
    // would be misinterpreted as a `RunnableMap` (a record of named runnables)
    // and fail with "Expected a Runnable, function or object".
    const wrapper = new AgentNodeWrapper({ agent, inputGuardrails, outputGuardrails, agentConfig });
    return (state, config) => wrapper.__call__(state, config);
}

// ── Agent Instantiation ───────────────────────────────────────────

async function importClass(classPath: string): Promise<unknown> {
    const parts = classPath.split("#");
    const modulePath = parts[0];
    const exportName = parts[1] ?? "default";

    if (modulePath.startsWith(".")) {
        const { pathToFileURL } = await import("node:url");
        const { resolve } = await import("node:path");
        const resolved = resolve(process.cwd(), modulePath);
        const mod = await import(pathToFileURL(resolved).href);
        return mod[exportName] ?? mod;
    }

    const mod = await import(modulePath);
    return mod[exportName] ?? mod;
}

 
async function buildChatModel(
    model: string,
    opts?: Record<string, unknown>,
): Promise<ChatModelLike | null> {
    try {
        const modPath = "../llm/index.js";
        const mod = await import(modPath);
        if (mod.buildChatModel && typeof mod.buildChatModel === "function") {
            return mod.buildChatModel(model, opts) as ChatModelLike;
        }
    } catch {
        // llm module not available
    }
    return null;
}

async function instantiateAgent(
    _name: string,
    agentConfig: OrchidAgentConfig,
    defaultModel: string,
    reader: OrchidVectorReader,
    defaultChatModel: ChatModelLike | null = null,
    defaultFallback: string | null = null,
    defaultRetry = 0,
    mcpClientFactory: ((server: any) => any) | null = null,
    summaryConfig: Record<string, unknown> | null = null,
    graphStore: unknown = null,
    contentSources: unknown = null,
    _uploadNamespace = "uploads",
): Promise<OrchidAgent> {
    let cls: new (opts: Record<string, unknown>) => OrchidAgent;

    const classPath = (agentConfig as Record<string, unknown>).class as string | null;
    if (classPath) {
        try {
            const resolved = await importClass(classPath);
            cls = resolved as new (opts: Record<string, unknown>) => OrchidAgent;
        } catch {
            const { GenericAgent } = await import("../agents/genericAgent.js");
            cls = GenericAgent as unknown as new (opts: Record<string, unknown>) => OrchidAgent;
        }
    } else {
        const { GenericAgent } = await import("../agents/genericAgent.js");
        cls = GenericAgent as unknown as new (opts: Record<string, unknown>) => OrchidAgent;
    }

    const factory =
        mcpClientFactory ??
        ((server: Record<string, unknown>) => ({
            url: server["url"],
            name: server["name"],
        }));
    const mcpClients = (agentConfig.mcpServers ?? []).map((server: Record<string, unknown>) =>
        factory(server as Record<string, unknown>),
    );

    const agentLLM = (agentConfig as Record<string, unknown>).llm as
        | Record<string, unknown>
        | null
        | undefined;
    const agentModel = agentLLM?.model ? String(agentLLM.model) : defaultModel;

    let agentChatModel = defaultChatModel;
    try {
        const built = await buildChatModel(agentModel, {
            fallbackModel: agentLLM?.fallbackModel
                ? String(agentLLM.fallbackModel)
                : (defaultFallback ?? undefined),
            retryAttempts: agentLLM?.retryAttempts ? Number(agentLLM.retryAttempts) : defaultRetry,
            temperature: agentLLM?.temperature ? Number(agentLLM.temperature) : 0.2,
        });
        if (built) agentChatModel = built;
    } catch {
        // Use default chat model
    }

    const kwargs: Record<string, unknown> = {
        config: agentConfig,
        reader,
        mcpClients,
        chatModel: agentChatModel,
    };
    if (summaryConfig) kwargs.summaryConfig = summaryConfig;
    if (graphStore !== null) kwargs.graphStore = graphStore;
    if (contentSources) kwargs.contentSources = contentSources;

    return new cls(kwargs) as OrchidAgent;
}

// ── Graph Builder (Composition Root) ──────────────────────────────

export async function buildGraph(opts: {
    config: OrchidAgentsConfig;
    runtime: OrchidRuntime;
    agentsOut?: Record<string, OrchidAgent> | null;
}): Promise<unknown> {
    const { config, runtime, agentsOut = null } = opts;

    const reader = runtime.getReader();
    const graphStore = runtime.getGraphStore();
    const defaultModel = runtime.defaultModel;

    if (
        config.allowedPassthroughHosts &&
        config.allowedPassthroughHosts.length > 0 &&
        !runtime.allowedPassthroughHosts
    ) {
        runtime.allowedPassthroughHosts = config.allowedPassthroughHosts;
    }

    const defaultFallback = config.defaults.llm.fallbackModel ?? null;
    const defaultRetry = config.defaults.llm.retryAttempts ?? 0;

    let defaultChatModel: ChatModelLike | null = runtime.chatModel;
    if (!defaultChatModel) {
        try {
            const built = await buildChatModel(defaultModel, {
                fallbackModel: defaultFallback ?? undefined,
                retryAttempts: defaultRetry,
            });
            if (built) defaultChatModel = built;
        } catch {
            // No chat model factory available — graph will work but may fail when LLM is needed
        }
    }

    // Build MCP auth registry (lazy import — may not be available)
    try {
        const mod = await import("../mcp/authRegistry.js");
        if (
            mod.OrchidMCPAuthRegistry &&
            typeof mod.OrchidMCPAuthRegistry.fromConfig === "function"
        ) {
            const authRegistry = mod.OrchidMCPAuthRegistry.fromConfig(config);
            runtime.mcpAuthRegistry = authRegistry;
        }
    } catch {
        // MCP auth registry not available
    }

    const mcpFactory = runtime.getMcpClientFactory();

    // Register built-in tools from config
    if (config.tools && Object.keys(config.tools).length > 0) {
        try {
            const { loadToolsFromConfig } = await import("../config/toolRegistry.js");
            loadToolsFromConfig(config.tools as Record<string, unknown>);
            console.info("[Graph] registered %d built-in tools", Object.keys(config.tools).length);
        } catch {
            // Tool registry not available
        }
    }

    // Build global guardrail chains
    const guardrails = (config.guardrails ?? {}) as Record<string, unknown>;
    const { input: globalInputChain, output: globalOutputChain } =
        await GuardrailWiring.buildChains(guardrails);
    const hasGlobalInputRails = !globalInputChain.empty;
    const hasGlobalOutputRails = !globalOutputChain.empty;

    if (hasGlobalInputRails) {
        console.info("[Graph] global input guardrails: %d rules", globalInputChain.length);
    }
    if (hasGlobalOutputRails) {
        console.info("[Graph] global output guardrails: %d rules", globalOutputChain.length);
    }

    // Build agent descriptions directly from config
    const agentDescriptions: Record<string, string> = {};
    for (const [name, cfg] of Object.entries(config.agents)) {
        agentDescriptions[name] = ((cfg as Record<string, unknown>).description as string) ?? "";
    }

    // Build summary config from supervisor
    const sup = config.supervisor;
    let summaryCfg: Record<string, unknown> | null = null;
    if (sup.historySummaryEnabled) {
        summaryCfg = {
            model: sup.historySummaryModel ?? defaultModel,
            recentTurns: sup.historySummaryRecentTurns,
        };
    }

    // Build conversation memory instance
    let memory: OrchidConversationMemory | null = null;
    const memoryStrategy = sup.memory.strategy;
    if (memoryStrategy !== "none" && runtime.chatStorage != null) {
        try {
            const memoryModel = sup.memory.summaryModel ?? sup.historySummaryModel ?? defaultModel;

            let memoryChatModel: ChatModelLike | null = null;
            try {
                const built = await buildChatModel(memoryModel, {
                    fallbackModel: defaultFallback ?? undefined,
                    retryAttempts: 0,
                });
                if (built) memoryChatModel = built;
            } catch {
                // Fall through
            }

            if (memoryStrategy === "rag_augmented" && memoryChatModel) {
                const { OrchidRAGConversationMemory } = await import("../agents/memoryRag.js");
                memory = new OrchidRAGConversationMemory(
                    runtime.chatStorage as any,
                    memoryChatModel,
                    runtime.getReader(),
                    (runtime as any).getWriter?.() ?? null,
                    { structuredOutput: sup.memory.structuredOutput },
                ) as unknown as OrchidConversationMemory;
                console.info(
                    "[Graph] memory strategy=rag_augmented model=%s namespace=%s k=%d",
                    memoryModel,
                    sup.memory.ragNamespace,
                    sup.memory.ragK,
                );
            } else if (memoryStrategy === "running_summary" && memoryChatModel) {
                const mod = await import("../agents/memory.js");
                memory = new mod.OrchidInMemoryConversationMemory(
                    runtime.chatStorage as any,
                    memoryChatModel,
                    { structuredOutput: sup.memory.structuredOutput },
                ) as unknown as OrchidConversationMemory;
                console.info(
                    "[Graph] memory strategy=running_summary model=%s persist=%s structured=%s",
                    memoryModel,
                    sup.memory.persistSummary,
                    sup.memory.structuredOutput,
                );
            }

            if (memory && summaryCfg) {
                summaryCfg.memory = memory;
                summaryCfg.structuredOutput = sup.memory.structuredOutput;
            }
        } catch (exc: unknown) {
            console.warn("[Graph] Failed to initialise memory: %s", String(exc));
            const { NullConversationMemory } = await import("../core/memory.js");
            memory = new NullConversationMemory();
        }
    } else if (memoryStrategy !== "none" && runtime.chatStorage == null) {
        console.warn(
            "[Graph] memory.strategy=%s configured but no chatStorage in runtime — memory disabled",
            memoryStrategy,
        );
    }

    if (memory === null) {
        const { NullConversationMemory } = await import("../core/memory.js");
        memory = new NullConversationMemory();
    }

    if (summaryCfg) {
        summaryCfg.truncationStrategy = sup.memory.truncationStrategy;
        summaryCfg.truncationMaxChars = sup.memory.truncationMaxChars;
    }

    // Instantiate agents from config
    const agents: OrchidAgent[] = [];
    const agentGuardrails: Record<
        string,
        { input: OrchidGuardrailChain; output: OrchidGuardrailChain }
    > = {};

    for (const [agentName, agentConfig] of Object.entries(config.agents)) {
        if ((agentConfig as Record<string, unknown>).children) {
            console.info(
                "[Graph] agent %s has children — sub-graphs not yet supported in orchid-ts",
                agentName,
            );
            continue;
        }

        const agent = await instantiateAgent(
            agentName,
            agentConfig,
            defaultModel,
            reader,
            defaultChatModel,
            defaultFallback,
            defaultRetry,
            mcpFactory,
            summaryCfg,
            graphStore,
            runtime.contentSources,
            runtime.uploadNamespace,
        );
        agents.push(agent);

        const agentGuardrailsCfg = (agentConfig as Record<string, unknown>).guardrails as
            | Record<string, unknown>
            | undefined;
        if (agentGuardrailsCfg && (agentGuardrailsCfg.input || agentGuardrailsCfg.output)) {
            const { input: inputChain, output: outputChain } =
                await GuardrailWiring.buildChains(agentGuardrailsCfg);
            agentGuardrails[agentName] = { input: inputChain, output: outputChain };
            console.info(
                "[Graph] agent '%s' guardrails: input=%d, output=%d",
                agentName,
                inputChain.length,
                outputChain.length,
            );
        }
    }

    // Wire agent peers
    const agentMap: Record<string, OrchidAgent> = {};
    for (const agent of agents) {
        agentMap[agent.name] = agent;
    }
    if (agentsOut !== null) {
        Object.assign(agentsOut, agentMap);
    }

    for (const agent of agents) {
        const needsWiring = (agent as any).needsPeerWiring;
        if (typeof needsWiring === "function" && needsWiring.call(agent)) {
            const peers: Record<string, OrchidAgent> = {};
            for (const [name, peer] of Object.entries(agentMap)) {
                if (name !== agent.name) peers[name] = peer;
            }
            if (typeof (agent as any).wirePeers === "function") {
                (agent as any).wirePeers(peers);
                console.info(
                    "[Graph] agent '%s' wired with peers: %s",
                    agent.name,
                    Object.keys(peers),
                );
            }
        }
    }

    // Supervisor chat model
    const supFallback = sup.fallbackModel ?? defaultFallback;
    let supervisorChatModel = defaultChatModel;
    if (sup.fallbackModel && sup.fallbackModel !== defaultFallback) {
        try {
            const built = await buildChatModel(defaultModel, {
                fallbackModel: supFallback ?? undefined,
                retryAttempts: defaultRetry,
            });
            if (built) supervisorChatModel = built;
        } catch {
            // Fall through
        }
    }

    // Optional routing chat model (cheaper, for short calls)
    let routingChatModel: ChatModelLike | null = null;
    if (sup.routingModel && sup.routingModel !== defaultModel) {
        try {
            const built = await buildChatModel(sup.routingModel, {
                fallbackModel: supFallback ?? undefined,
                retryAttempts: defaultRetry,
            });
            if (built) {
                routingChatModel = built;
                console.info(
                    "[Graph] supervisor routing_model=%s (separate from synthesis model)",
                    sup.routingModel,
                );
            }
        } catch {
            // Fall through
        }
    }

    // Create supervisor node
    const supervisorNode = createSupervisorNode({
        model: defaultModel,
        agentDescriptions,
        chatModel: supervisorChatModel,
        orchestratorSkills: config.skills ?? null,
        supervisorConfig: config.supervisor,
        routingChatModel,
        memory,
    });

    // Build graph using LangGraph adapter
    const g = await LangGraphAdapter.createStateGraph({
        messages: null,
        activeAgents: null,
        pendingAgents: null,
        executionMode: null,
        finalResponse: null,
        mcpContext: null,
        ragContext: null,
        skillInstructions: null,
        hasOutputGuardrails: null,
        mcpAuthStatus: null,
        miniAgentDecisions: null,
        miniAgentOutcomes: null,
        chatId: null,
    }) as Record<string, unknown>;

    // Bind methods to `g` so `this` is preserved when called as standalone
    // functions. LangGraph's methods read `this.channels` / `this.nodes` etc.;
    // destructuring without .bind() would leave `this` undefined and throw
    // "Cannot read properties of undefined (reading 'channels')".
    const addNode = (g["addNode"] as (...args: unknown[]) => unknown).bind(g) as (
        name: string,
        node: unknown,
    ) => void;
    const addEdge = (g["addEdge"] as (...args: unknown[]) => unknown).bind(g) as (
        from: string,
        to: string,
    ) => void;
    const addConditionalEdges = (
        g["addConditionalEdges"] as (...args: unknown[]) => unknown
    ).bind(g) as (source: string, router: unknown, destinations?: string[]) => void;
    const setEntryPoint = (g["setEntryPoint"] as (...args: unknown[]) => unknown).bind(
        g,
    ) as (name: string) => void;
    const compile = (g["compile"] as (...args: unknown[]) => unknown).bind(g) as (
        opts?: Record<string, unknown>,
    ) => unknown;

    // Add global input guardrails node (before supervisor)
    if (hasGlobalInputRails) {
        addNode("input_guardrails", GuardrailWiring.createGlobalInputNode(globalInputChain));
    }

    addNode("supervisor", supervisorNode);

    // Add global output guardrails node (after synthesis)
    if (hasGlobalOutputRails) {
        addNode("output_guardrails", GuardrailWiring.createGlobalOutputNode(globalOutputChain));
    }

    for (const agent of agents) {
        const nodeName = `${agent.name}_agent`;
        const ag = agentGuardrails[agent.name];
        const inputChain = ag?.input ?? null;
        const outputChain = ag?.output ?? null;
        const agentConfig = (config.agents as Record<string, OrchidAgentConfig>)[agent.name];

        addNode(nodeName, createAgentNode(agent, inputChain, outputChain, agentConfig ?? null));

        // Wire mini-agent topology if enabled
        const miniEnabled = agentConfig?.miniAgent?.enabled === true;
        const parentChatModel = (agent as any)._chatModel as ChatModelLike | null;
        if (miniEnabled && parentChatModel != null) {
            try {
                await MiniAgentWiring.wireMiniTopology(
                    g,
                    agent.name,
                    agentConfig as unknown as Record<string, unknown>,
                    parentChatModel,
                    ((agent as any).mcpClients as unknown[]) ?? [],
                    nodeName,
                );
            } catch {
                if (miniEnabled && parentChatModel === null) {
                    console.warn(
                        "[Graph] agent '%s' has mini_agent.enabled=true but no chat_model — mini-agent topology disabled",
                        agent.name,
                    );
                }
                addEdge(nodeName, "supervisor");
            }
        } else {
            addEdge(nodeName, "supervisor");
        }
    }

    // Wire entry point and edges
    if (hasGlobalInputRails) {
        setEntryPoint("input_guardrails");
        addConditionalEdges(
            "input_guardrails",
            (state: GraphState) => {
                if (state.finalResponse != null) return END;
                return "supervisor";
            },
            ["supervisor", END],
        );
    } else {
        setEntryPoint("supervisor");
    }

    // Supervisor conditional edges
    addConditionalEdges("supervisor", (state: GraphState) => {
        const result = routeToAgents(state);
        if (Array.isArray(result)) return result;
        if (result === "__end__") return END;
        return result;
    });

    // Output guardrails to END
    if (hasGlobalOutputRails) {
        addEdge("output_guardrails", END);
    }

    // Only pass the checkpointer when it's set. LangGraph's `PregelLoop`
    // constructor reads `checkpointer.getNextVersion` unconditionally at
    // loop init; passing `checkpointer: null` makes it throw
    // "Cannot read properties of null (reading 'getNextVersion')".
    const compiled = runtime.checkpointer
        ? compile({ checkpointer: runtime.checkpointer })
        : compile();
    if (runtime.checkpointer) {
        console.info(
            "[Graph] compiled with checkpointer=%s, agents=%s",
            typeof runtime.checkpointer === "object" && runtime.checkpointer !== null
                ? ((runtime.checkpointer as Record<string, unknown>).constructor?.name ?? "unknown")
                : "unknown",
            Object.keys(agentDescriptions),
        );
    } else {
        console.info("[Graph] compiled with agents: %s", Object.keys(agentDescriptions));
    }

    return compiled;
}
