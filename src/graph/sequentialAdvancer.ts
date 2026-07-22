import type { ChatModelLike } from "../core/helpers.js";
import { OrchidAgent } from "../core/agent.js";
import type { OrchidConversationMemory } from "../core/memory.js";
import type { OrchidSupervisorConfig } from "../config/schema/supervisor.js";
import { llmComplete } from "./supervisorHelpers.js";
import type { GraphState } from "./state.js";

export const SEQUENTIAL_ADVANCE_SYSTEM_PROMPT = `You are the Supervisor of the {assistant_name}.
A sub-agent has just completed a step in a sequential pipeline.

Previous agent results are in the conversation.
The NEXT agent in the pipeline is: **{next_agent}** ({next_description}).
Remaining pipeline: {remaining}
{skill_instruction_section}
Your job: write a brief handoff message that summarises what was found so far
and what the next agent should focus on.  This message will be visible to the
next agent in the conversation history.

Be concise — one or two sentences.
`;

export class SequentialAdvancer {
    private model: string;
    private agentDescriptions: Record<string, string>;
    private supervisorConfig: OrchidSupervisorConfig;
    private chatModel: ChatModelLike | null;
    private memory: OrchidConversationMemory | null;

    constructor({
        model,
        agentDescriptions,
        supervisorConfig,
        chatModel,
        memory = null,
    }: {
        model: string;
        agentDescriptions: Record<string, string>;
        supervisorConfig: OrchidSupervisorConfig;
        chatModel: ChatModelLike | null;
        memory?: OrchidConversationMemory | null;
    }) {
        this.model = model;
        this.agentDescriptions = agentDescriptions;
        this.supervisorConfig = supervisorConfig;
        this.chatModel = chatModel;
        this.memory = memory;
    }

    async advance(state: GraphState, pending: string[]): Promise<Partial<GraphState>> {
        const nextAgent = pending[0];
        const remaining = pending.slice(1);

        const nextDesc = this.agentDescriptions[nextAgent] ?? "";
        const remainingStr = remaining.length > 0 ? remaining.join(" → ") : "(last step)";

        const skillInstructions = (state.skillInstructions ?? {}) as Record<string, string>;
        const instruction = skillInstructions[nextAgent] ?? "";
        const skillInstructionSection = instruction
            ? `\nSKILL INSTRUCTION for ${nextAgent}: ${instruction}\n`
            : "";

        const sup = this.supervisorConfig;
        const advanceTemplate = sup.sequentialAdvancePrompt ?? SEQUENTIAL_ADVANCE_SYSTEM_PROMPT;
        const system = advanceTemplate
            .replace("{assistant_name}", sup.assistantName)
            .replace("{next_agent}", nextAgent)
            .replace("{next_description}", nextDesc)
            .replace("{remaining}", remainingStr)
            .replace("{skill_instruction_section}", skillInstructionSection);

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

        const cleanHistory = history.filter((m) => !m.content.startsWith("[Conversation summary]"));

        const llmMessages: Array<Record<string, unknown>> = [{ role: "system", content: system }];
        llmMessages.push(...(cleanHistory as unknown as Array<Record<string, unknown>>));

        const mcpCtx = state.mcpContext ?? {};
        if (Object.keys(mcpCtx).length > 0) {
            const contextBlob = JSON.stringify(mcpCtx, null, 2);
            llmMessages.push({
                role: "user",
                content: `Data collected so far:\n\`\`\`json\n${contextBlob}\n\`\`\``,
            });
        }

        let handoff: string;
        try {
            handoff = await llmComplete(this.chatModel, this.model, llmMessages, {
                temperature: 0.2,
            });
            console.info(
                "[supervisor] sequential advance → %s (pending: %s): %s",
                nextAgent,
                remaining,
                handoff.slice(0, 100),
            );
        } catch (exc: unknown) {
            const errorMsg = String(exc instanceof Error ? exc.message : exc);
            console.error("[supervisor] LLM API error during sequential handoff: %s", errorMsg);
            handoff = `Continue with ${nextAgent} to address the user's request.`;
        }

        const result = {
            activeAgents: [nextAgent],
            pendingAgents: remaining,
            executionMode: "sequential" as const,
            messages: [
                { role: "ai", content: `[Supervisor → ${nextAgent}] ${handoff}` },
            ] as unknown[],
            finalResponse: null,
        };
        console.info("[SequentialAdvancer] returning: activeAgents=%s, pendingAgents=%s, finalResponse=%s",
            result.activeAgents, result.pendingAgents, result.finalResponse);
        return result;
    }
}
