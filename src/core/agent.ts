/**
 * Base agent abstraction — Open/Closed Principle.
 *
 * Adding a new agent = subclass OrchidAgent + register in Composition Root.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { OrchidAuthContext } from "./state.js";
import type { OrchidAgentState } from "./state.js";
import type { OrchidVectorReader } from "./repository.js";
import type { OrchidRAGScope } from "./scopes.js";
import type { OrchidContentSource } from "./content.js";
import type { OrchidMCPClient } from "./mcpInterfaces.js";
import type { ChatModelLike } from "./helpers.js";
import {
    extractUserQuery,
    extractConversationHistory,
    compressConversationHistory,
    summarise,
    fetchRagContext,
} from "./helpers.js";
import type { ExtractHistoryOptions, ConversationMessage } from "./helpers.js";

export interface OrchidAgentRunContext {
    auth: OrchidAuthContext | null;
    correlationId: string | null;
    chatId: string | null;
    messageId: string | null;
}

const emptyRunContext: OrchidAgentRunContext = {
    auth: null,
    correlationId: null,
    chatId: null,
    messageId: null,
};

const runCtxVar = new AsyncLocalStorage<OrchidAgentRunContext>();

export function getRunContext(): OrchidAgentRunContext {
    return runCtxVar.getStore() ?? emptyRunContext;
}

export function runWithContext<T>(ctx: OrchidAgentRunContext, fn: () => Promise<T>): Promise<T> {
    return runCtxVar.run(ctx, fn);
}

export abstract class OrchidAgent {
    modelId: string;
    reader: OrchidVectorReader;
    mcpClients: OrchidMCPClient[];
    /** Role claim whitelist for the Pollen + Bloom events runner (§15.1). */
    eventsRoleClaimFilter: string[] | null = null;
    /** Per-agent summarisation prompt overrides (agents.yaml). */
    summaryConfig: Record<string, unknown> | null = null;
    /** Per-agent graph store (optional, for graph RAG strategies). */
    graphStore: unknown = null;
    protected _chatModel: ChatModelLike | null;

    constructor({
        modelId = "",
        reader,
        mcpClients,
        chatModel = null,
        uploadNamespace = "uploads",
        contentSources,
        summaryConfig,
        graphStore,
    }: {
        modelId?: string;
        reader: OrchidVectorReader;
        mcpClients?: OrchidMCPClient[] | null;
        chatModel?: ChatModelLike | null;
        uploadNamespace?: string;
        contentSources?: OrchidContentSource[] | null;
        summaryConfig?: Record<string, unknown> | null;
        graphStore?: unknown;
    }) {
        this.modelId = modelId;
        this.reader = reader;
        this.mcpClients = mcpClients ?? [];
        this._chatModel = chatModel;
        this._uploadNamespace = uploadNamespace;
        this._contentSources = contentSources ?? [];
        this.summaryConfig = summaryConfig ?? null;
        this.graphStore = graphStore ?? null;
    }

    protected _uploadNamespace: string;

    get uploadNamespace(): string {
        return this._uploadNamespace;
    }

    protected _contentSources: OrchidContentSource[];

    get contentSources(): OrchidContentSource[] {
        return this._contentSources;
    }

    /** Unique identifier (e.g., "knowledge-base"). */
    abstract get name(): string;

    /** Description the Supervisor reads to decide routing. */
    abstract get description(): string;

    get ragNamespace(): string {
        return this.name;
    }

    /** Extract the last human message from the state. */
    static extractUserQuery(state: OrchidAgentState): string {
        return extractUserQuery(state);
    }

    /** Extract clean user/assistant pairs from graph state messages. */
    static extractConversationHistory(
        state: OrchidAgentState,
        options?: ExtractHistoryOptions,
    ): ConversationMessage[] {
        return extractConversationHistory(state, options);
    }

    /** Sliding-window conversation compression. */
    static async compressConversationHistory(
        history: ConversationMessage[],
        chatModel: ChatModelLike,
        options?: {
            recentTurns?: number;
            runningSummary?: string;
            structuredOutput?: boolean;
        },
    ): Promise<ConversationMessage[]> {
        return compressConversationHistory(history, chatModel, options);
    }

    abstract run(state: OrchidAgentState): Promise<OrchidAgentState>;

    async summarise(
        query: string,
        mcpData: Record<string, unknown> | null = null,
        ragData: Record<string, unknown> | null = null,
        {
            systemPrompt,
            conversationHistory,
            priorToolContext,
        }: {
            systemPrompt?: string;
            conversationHistory?: ConversationMessage[];
            priorToolContext?: Record<string, unknown> | null;
        } = {},
    ): Promise<string> {
        if (!this._chatModel) throw new Error("No chat model available for summarisation");
        return summarise(query, mcpData, ragData, this._chatModel, {
            systemPrompt,
            conversationHistory,
            priorToolContext,
        });
    }

    async fetchRagContext(
        query: string,
        scope: OrchidRAGScope,
        namespace?: string,
        k = 5,
    ): Promise<
        { document: { pageContent: string; metadata: Record<string, unknown> }; score: number }[]
    > {
        return fetchRagContext(query, scope, this.reader, namespace ?? this.ragNamespace, k);
    }

    protected async callBuiltinTool(
        _toolName: string,
        _arguments_: Record<string, unknown>,
    ): Promise<string> {
        throw new Error(`Built-in tool not implemented: ${_toolName}`);
    }
}
