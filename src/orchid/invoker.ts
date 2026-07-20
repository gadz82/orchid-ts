import type { OrchidAuthContext } from "../core/index.js";
import { withAuth, GraphInterrupt, extractTextContent } from "../core/index.js";

export class OrchidPendingApproval {
    tool: string;
    args: Record<string, unknown>;
    agent: string;
    interruptId: string;

    constructor(opts: {
        tool: string;
        args: Record<string, unknown>;
        agent: string;
        interruptId?: string;
    }) {
        this.tool = opts.tool;
        this.args = opts.args;
        this.agent = opts.agent;
        this.interruptId = opts.interruptId ?? "";
    }
}

export class OrchidInvokeResult {
    response: string;
    chatId: string;
    agentsUsed: string[] = [];
    messages: any[] = [];
    interrupted: boolean = false;
    approvalsNeeded: OrchidPendingApproval[] = [];
    mcpContext: Record<string, unknown> = {};
    ragContext: Record<string, unknown> = {};

    constructor(fields?: Partial<OrchidInvokeResult>) {
        this.response = fields?.response ?? "";
        this.chatId = fields?.chatId ?? "";
        if (fields) Object.assign(this, fields);
    }
}

export class OrchidInvoker {
    private graph: any;
    private chatRepo: any | null;
    private checkpointer: any | null;

    constructor(opts: { graph: any; chatRepo?: any | null; checkpointer?: any | null }) {
        this.graph = opts.graph;
        this.chatRepo = opts.chatRepo ?? null;
        this.checkpointer = opts.checkpointer ?? null;
    }

    async invoke(opts: {
        message: string;
        chatId?: string | null;
        userId?: string;
        tenantId?: string;
        accessToken?: string;
        auth?: OrchidAuthContext | null;
        history?: any[] | null;
        persist?: boolean;
    }): Promise<OrchidInvokeResult> {
        const { state, config, chatId } = this.prepareInvocation(opts);

        try {
            // `@langchain/langgraph@0.2.74` exposes `Pregel.invoke()` (sync,
            // returns a Promise) — there is no `ainvoke()` on the compiled
            // graph. The previous code called `ainvoke` and crashed with
            // "ainvoke is not a function" on the very first message.
            const result = await this.graph.invoke(state, config);
            if (opts.persist !== false && this.chatRepo && chatId) {
                await this.persistMessages(chatId, opts.message, result);
            }
            return this.resultFromGraphOutput(result, chatId);
        } catch (exc: unknown) {
            if (exc instanceof GraphInterrupt || (exc as any)?.type === "tool_approval") {
                return this.interruptToResult(exc as any, chatId);
            }
            throw exc;
        }
    }

    /**
     * Invoke the graph with a pre-built state. Used by the API layer
     * after `prepareGraphState` has already constructed a full state
     * (including history, RAG context, MCP auth status, etc.). Unlike
     * `invoke({ message })`, this method passes the state through
     * unchanged — it does NOT rebuild it from a single message string.
     */
    async invokeState(
        state: object,
        opts: {
            chatId?: string | null;
            auth?: OrchidAuthContext | null;
            persist?: boolean;
        } = {},
    ): Promise<OrchidInvokeResult> {
        const stateObj = state as Record<string, unknown>;
        const chatId =
            opts.chatId ??
            (stateObj["chatId"] as string | undefined) ??
            (stateObj["chat_id"] as string | undefined) ??
            `chat-${Date.now()}`;
        const auth = opts.auth ?? null;
        const config = withAuth(auth, { threadId: chatId });

        try {
            const result = await this.graph.invoke(state, config);
            if (opts.persist !== false && this.chatRepo && chatId) {
                const userMessage = this.extractUserMessageFromState(stateObj);
                if (userMessage) {
                    await this.persistMessages(chatId, userMessage, result);
                }
            }
            return this.resultFromGraphOutput(result, chatId);
        } catch (exc: unknown) {
            if (exc instanceof GraphInterrupt || (exc as any)?.type === "tool_approval") {
                return this.interruptToResult(exc as any, chatId);
            }
            throw exc;
        }
    }

    async resume(opts: {
        chatId: string;
        auth?: OrchidAuthContext | null;
        approved?: boolean;
        persist?: boolean;
    }): Promise<OrchidInvokeResult> {
        if (!this.checkpointer) {
            throw new Error("Cannot resume: no checkpointer configured");
        }
        const auth = opts.auth ?? null;
        const config = withAuth(auth, { threadId: opts.chatId });
        const command = { resume: { approved: opts.approved ?? true } };

        try {
            // `Pregel.invoke` — there is no `ainvoke` on the TS port.
            const result = await this.graph.invoke(command, config);
            if (opts.persist !== false && this.chatRepo) {
                await this.persistMessages(opts.chatId, "", result);
            }
            return this.resultFromGraphOutput(result, opts.chatId);
        } catch (exc: unknown) {
            if (exc instanceof GraphInterrupt || (exc as any)?.type === "tool_approval") {
                return this.interruptToResult(exc as any, opts.chatId);
            }
            throw exc;
        }
    }

    async stream(opts: {
        message: string;
        chatId?: string | null;
        userId?: string;
        tenantId?: string;
        accessToken?: string;
        auth?: OrchidAuthContext | null;
        history?: any[] | null;
        streamMode?: string | string[];
    }): Promise<AsyncIterable<[string, unknown]>> {
        const { state, config } = this.prepareInvocation(opts);
        const mode = opts.streamMode ?? "updates";
        // `@langchain/langgraph@0.2.74` exposes `Pregel.stream()` — there is
        // no `astream()` on the compiled graph (that's the Python name).
        return this.graph.stream(state, { ...config, streamMode: mode });
    }

    /**
     * Stream the graph with a pre-built state. Used by the API layer
     * after `prepareGraphState` has constructed the full state. Unlike
     * `stream({ message })`, this method passes the state through
     * unchanged — it does NOT rebuild it from a single message string.
     */
    async streamState(
        state: object,
        opts: {
            chatId?: string | null;
            auth?: OrchidAuthContext | null;
            streamMode?: string | string[];
        } = {},
    ): Promise<AsyncIterable<[string, unknown]>> {
        const stateObj = state as Record<string, unknown>;
        const chatId =
            opts.chatId ??
            (stateObj["chatId"] as string | undefined) ??
            (stateObj["chat_id"] as string | undefined) ??
            `chat-${Date.now()}`;
        const auth = opts.auth ?? null;
        const config = withAuth(auth, { threadId: chatId });
        const mode = opts.streamMode ?? "updates";
        return this.graph.stream(state, { ...config, streamMode: mode });
    }

    private prepareInvocation(opts: {
        message: string;
        chatId?: string | null;
        userId?: string;
        tenantId?: string;
        accessToken?: string;
        auth?: OrchidAuthContext | null;
        history?: any[] | null;
    }): { state: any; config: any; chatId: string; auth: OrchidAuthContext | null } {
        const auth = opts.auth ?? null;
        const chatId = opts.chatId ?? `chat-${Date.now()}`;
        const messages: any[] = [];
        if (opts.history) messages.push(...opts.history);
        if (opts.message) messages.push({ type: "human", content: opts.message });

        const state: Record<string, unknown> = { messages, chatId };
        const config = withAuth(auth, { threadId: chatId });

        return { state, config, chatId, auth };
    }

    private resultFromGraphOutput(result: any, chatId: string): OrchidInvokeResult {
        const msgs = result?.messages ?? [];
        let response = "";
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m.type === "ai" || m.role === "assistant") {
                response = extractTextContent(m.content);
                break;
            }
        }

        return new OrchidInvokeResult({
            response,
            chatId,
            messages: msgs,
            mcpContext: result?.mcpContext ?? result?.mcp_context ?? {},
            ragContext: result?.ragContext ?? result?.rag_context ?? {},
        });
    }

    private interruptToResult(exc: any, chatId: string): OrchidInvokeResult {
        const payload = exc.payload ?? exc.args?.[0] ?? {};
        const approvals: OrchidPendingApproval[] = [];
        if (payload.type === "tool_approval") {
            approvals.push(
                new OrchidPendingApproval({
                    tool: payload.tool ?? "unknown",
                    args: payload.args ?? {},
                    agent: payload.agent ?? "",
                }),
            );
        }
        return new OrchidInvokeResult({
            response: "",
            chatId,
            interrupted: true,
            approvalsNeeded: approvals,
        });
    }

    private extractUserMessageFromState(state: Record<string, unknown>): string {
        const messages = (state["messages"] as Array<Record<string, unknown>>) ?? [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            const t = typeof m["type"] === "string" ? m["type"] : m["role"];
            if (t === "human" || t === "user") {
                return String(m["content"] ?? "");
            }
        }
        return "";
    }

    private async persistMessages(chatId: string, userMessage: string, result: any): Promise<void> {
        if (!this.chatRepo) return;
        try {
            if (userMessage) {
                await this.chatRepo.addMessage(chatId, { role: "user", content: userMessage });
            }
            const msgs = result?.messages ?? [];
            for (const m of msgs) {
                if (m.type === "ai" || m.role === "assistant") {
                    await this.chatRepo.addMessage(chatId, {
                        role: "assistant",
                        content: extractTextContent(m.content),
                    });
                }
            }
        } catch {
            // Best effort
        }
    }
}
