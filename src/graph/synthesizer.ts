import type { ChatModelLike } from "../core/helpers.js";
import type { OrchidAuthContext } from "../core/state.js";
import { OrchidAgent } from "../core/agent.js";
import type { OrchidConversationMemory } from "../core/memory.js";
import type { OrchidSupervisorConfig } from "../config/schema/supervisor.js";
import { extractSingleAgentResponse, llmComplete } from "./supervisorHelpers.js";
import type { GraphState } from "./state.js";

export const SYNTHESIS_SYSTEM_PROMPT = `You are the Supervisor of the {assistant_name}.
The specialised sub-agents have completed their work.

IMPORTANT: Only answer the user's LATEST question or request.
The conversation history is provided for context only — do NOT
repeat or re-answer previous questions.

Combine agent results into a single coherent answer for the LATEST query.
Be concise but complete.  If data was retrieved, summarise it meaningfully.
Do NOT mention internal routing or agent names to the user.
`;

export class ResponseSynthesizer {
    private model: string;
    private supervisorConfig: OrchidSupervisorConfig;
    private chatModel: ChatModelLike | null;
    private memory: OrchidConversationMemory | null;

    constructor({
        model,
        supervisorConfig,
        chatModel,
        memory = null,
    }: {
        model: string;
        supervisorConfig: OrchidSupervisorConfig;
        chatModel: ChatModelLike | null;
        memory?: OrchidConversationMemory | null;
    }) {
        this.model = model;
        this.supervisorConfig = supervisorConfig;
        this.chatModel = chatModel;
        this.memory = memory;
    }

    async synthesise(
        state: GraphState,
        opts: { auth?: OrchidAuthContext | null } = {},
    ): Promise<Partial<GraphState>> {
        const fast = this.trySingleAgentFastPath(state);
        if (fast !== null) {
            await this.storeTurnIfRag(state, fast.finalResponse ?? "", opts.auth ?? null);
            return fast;
        }
        return await this.llmSynthesise(state, opts);
    }

    trySingleAgentFastPath(state: GraphState): Partial<GraphState> | null {
        const sup = this.supervisorConfig;
        if (!sup.skipSynthesisWhenSingleAgent) return null;
        const single = extractSingleAgentResponse(state);
        if (single === null) return null;

        console.info(
            "[supervisor] synthesis skipped — single agent produced final text (%d chars)",
            single.length,
        );
        return {
            messages: [{ role: "ai", content: single }] as unknown[],
            finalResponse: single,
            activeAgents: [],
            pendingAgents: [],
        };
    }

    async llmSynthesise(
        state: GraphState,
        opts: { auth?: OrchidAuthContext | null } = {},
    ): Promise<Partial<GraphState>> {
        const sup = this.supervisorConfig;
        const allMessages = (state.messages ?? []) as Array<Record<string, unknown>>;

        const isHuman = (m: Record<string, unknown>): boolean => {
            const t = typeof m["type"] === "string" ? m["type"] : "";
            const r = typeof m["role"] === "string" ? m["role"] : "";
            return t === "human" || r === "user" || r === "human";
        };

        let lastUserIdx = -1;
        for (let i = 0; i < allMessages.length; i++) {
            if (isHuman(allMessages[i])) lastUserIdx = i;
        }

        const currentTurn = lastUserIdx >= 0 ? allMessages.slice(lastUserIdx) : allMessages;

        const synthesisTemplate = sup.synthesisSystemPrompt ?? SYNTHESIS_SYSTEM_PROMPT;
        const synthesisPrompt = synthesisTemplate.replace("{assistant_name}", sup.assistantName);

        const llmMessages: Array<Record<string, unknown>> = [
            { role: "system", content: synthesisPrompt },
        ];

        let history = OrchidAgent.extractConversationHistory(state as any, {
            maxTurns: sup.historyMaxTurns,
            maxChars: sup.historyMaxChars,
            truncationStrategy: (sup.memory as Record<string, unknown>)?.truncationStrategy as
                | string
                | undefined,
        });

        if (history.length > 0 && sup.historySummaryEnabled && this.chatModel) {
            let runningSummary: string | null = null;
            if (this.memory && sup.memory.strategy !== "none") {
                const chatId = state.chatId ?? "";
                if (chatId) {
                    try {
                        runningSummary = await (this.memory as any).getRunningSummary?.(chatId);
                    } catch {
                        // Silently ignore
                    }
                }
            }
            history = await OrchidAgent.compressConversationHistory(history, this.chatModel, {
                recentTurns: sup.historySummaryRecentTurns,
                runningSummary: runningSummary ?? undefined,
                structuredOutput: sup.memory.structuredOutput,
            });

            if (this.memory && sup.memory.strategy !== "none") {
                const chatId = state.chatId ?? "";
                if (chatId) {
                    try {
                        const visibleHistory = history.filter(
                            (m) => !m.content.startsWith("[Conversation summary]"),
                        );
                        await (this.memory as any).updateRunningSummary?.(
                            chatId,
                            visibleHistory,
                            runningSummary,
                        );
                    } catch {
                        // Silently ignore
                    }
                }
            }
        }

        if (history.length > 0) {
            const visibleHistory = history.filter(
                (m) => !m.content.startsWith("[Conversation summary]"),
            );
            if (visibleHistory.length > 0) {
                llmMessages.push({
                    role: "user",
                    content:
                        "Previous conversation (for context only — do NOT re-answer or reproduce any of this):\n" +
                        visibleHistory.map((m) => `${m.role}: ${m.content}`).join("\n"),
                });
            }
        }

        for (const msg of currentTurn) {
            const msgType = typeof msg["type"] === "string" ? msg["type"] : "";
            const msgRole = typeof msg["role"] === "string" ? msg["role"] : "";
            const mIsHuman = msgType === "human" || msgRole === "user" || msgRole === "human";
            const mIsAi = msgType === "ai" || msgRole === "ai" || msgRole === "assistant";
            const content = String(msg["content"] ?? "");
            if (mIsHuman) {
                llmMessages.push({ role: "user", content });
            } else if (mIsAi) {
                if (
                    content.startsWith("[Supervisor") ||
                    content.startsWith("[Conversation summary]")
                )
                    continue;
                llmMessages.push({ role: "assistant", content });
            }
        }

        const mcpCtx = state.mcpContext ?? {};
        if (Object.keys(mcpCtx).length > 0) {
            const contextBlob = JSON.stringify(mcpCtx, null, 2);
            llmMessages.push({
                role: "user",
                content: `Sub-agent data (for reference):\n\`\`\`json\n${contextBlob}\n\`\`\``,
            });
        }

        let final: string;
        try {
            final = await llmComplete(this.chatModel, this.model, llmMessages, {
                temperature: 0.3,
            });
            console.info("[supervisor] synthesis complete (%d chars)", final.length);
        } catch (exc: unknown) {
            const errorMsg = String(exc instanceof Error ? exc.message : exc);
            console.error("[supervisor] LLM API error during synthesis: %s", errorMsg);
            if (errorMsg.includes("503") || errorMsg.toLowerCase().includes("high demand")) {
                final =
                    "I'm currently experiencing high demand and cannot synthesize the results. Please try again in a few moments.";
            } else if (errorMsg.toLowerCase().includes("rate limit")) {
                final = "I've hit my rate limit. Please try again in a few moments.";
            } else {
                final = `I encountered an error while synthesizing the response: ${errorMsg.slice(0, 200)}. Please try again later.`;
            }
        }

        await this.storeTurnIfRag(state, final, opts.auth ?? null);

        return {
            messages: [{ role: "ai", content: final }] as unknown[],
            finalResponse: final,
            activeAgents: [],
            pendingAgents: [],
        };
    }

    async storeTurnIfRag(
        state: GraphState,
        finalResponse: string,
        auth: OrchidAuthContext | null,
    ): Promise<void> {
        const sup = this.supervisorConfig;
        if (!this.memory || sup.memory.strategy !== "rag_augmented" || !sup.memory.storeTurns)
            return;
        if (typeof (this.memory as any).storeConversationTurn !== "function") return;

        const chatId = state.chatId ?? "";
        if (!chatId) return;
        const tenantId = auth?.tenantKey ?? "default";
        const userId = auth?.userId ?? "";

        try {
            const userQuery = OrchidAgent.extractUserQuery(state as any);
            if (userQuery) {
                await (this.memory as any).storeConversationTurn(
                    chatId,
                    tenantId,
                    userId,
                    { role: "user", content: userQuery },
                    { turnType: "synthesis", agent: "supervisor" },
                );
            }
            if (finalResponse) {
                await (this.memory as any).storeConversationTurn(
                    chatId,
                    tenantId,
                    userId,
                    { role: "assistant", content: finalResponse },
                    { turnType: "synthesis", agent: "supervisor" },
                );
            }
        } catch {
            // Silently ignore
        }
    }
}
