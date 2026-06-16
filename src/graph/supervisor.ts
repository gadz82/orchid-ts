import { z } from "zod";
import type { ChatModelLike } from "../core/helpers.js";
import { OrchidAgent } from "../core/agent.js";
import type { OrchidConversationMemory } from "../core/memory.js";
import { authFromConfig } from "../core/runConfig.js";
import type { OrchidAuthContext } from "../core/state.js";
import type { OrchidSupervisorConfig } from "../config/schema/supervisor.js";
import type { OrchidOrchestratorSkillConfig } from "../config/schema/skills.js";
import { SequentialAdvancer } from "./sequentialAdvancer.js";
import { ResponseSynthesizer } from "./synthesizer.js";
import type { GraphState } from "./state.js";

export const ROUTING_SYSTEM_PROMPT = `You are the Supervisor of the {assistant_name}.
Your role is to analyse the user's request and decide which specialised
sub-agents to activate.  You do NOT have access to any external tool or API.

Available agents:
{agent_descriptions}

EXECUTION MODES:
- "parallel"   — agents run simultaneously.  Use when they are INDEPENDENT
                  (e.g. looking up data AND listing available options).
- "sequential" — agents run one after another, in the order you specify.
                  Use when one agent's output is NEEDED by the next
                  (e.g. first find data, THEN act on it).

AVAILABLE SKILLS (pre-defined multi-agent workflows):
{skill_descriptions}

RULES:
- Route to one or more agents when the request requires domain-specific data or actions.
- Choose the right execution mode based on agent dependencies.
- If a pre-defined SKILL matches the user's request, prefer it over manual routing.
- If you can answer directly (greeting, general question), set directResponse.
- For follow-up messages like "yes", "tell me more", "go ahead", ALWAYS re-route
  to the SAME agent(s) that handled the previous turn.  Never return empty agents
  for a follow-up question.

FIELD INSTRUCTIONS (you MUST follow these):
- "reasoning": Explain WHY you chose these agents (1-2 sentences).
- "execution": One of "parallel", "sequential", or "skill".
- "agents": List of agent NAMES to activate. MUST NOT be empty unless you set
  directResponse. Example: ["menu"] or ["menu", "orders"].
- "skill": Skill name ONLY when execution="skill". Otherwise null.
- "directResponse": Your answer ONLY when no agent is needed (greetings,
  general knowledge). Otherwise null.
`;

export const OrchidRoutingDecisionSchema = z.object({
    reasoning: z.string().describe("Brief analysis of the user's intent"),
    execution: z
        .enum(["parallel", "sequential", "skill"])
        .default("parallel")
        .describe(
            "Execution mode: parallel (independent agents), sequential (dependent), or skill (pre-defined workflow)",
        ),
    agents: z
        .array(z.string())
        .default([])
        .describe("Agent names to activate (empty if directResponse or skill)"),
    skill: z
        .string()
        .nullable()
        .default(null)
        .describe("Skill name to invoke (only when execution='skill')"),
    directResponse: z
        .string()
        .nullable()
        .default(null)
        .describe("Direct response to the user (only when no agent is needed)"),
});

export type OrchidRoutingDecision = z.infer<typeof OrchidRoutingDecisionSchema>;

function currentTurnHasAgentOutput(state: GraphState): boolean {
    const messages = (state.messages ?? []) as Array<Record<string, unknown>>;
    if (messages.length === 0) return false;

    let lastHuman = -1;
    for (let i = 0; i < messages.length; i++) {
        const msgType = typeof messages[i]["type"] === "string" ? messages[i]["type"] : "";
        if (msgType === "human") lastHuman = i;
    }

    for (const msg of messages.slice(lastHuman + 1)) {
        const msgType = typeof msg["type"] === "string" ? msg["type"] : "";
        if (msgType !== "ai") continue;
        const content = String(msg["content"] ?? "");
        if (content.startsWith("[") && content.includes("Agent]\n")) {
            return true;
        }
    }
    return false;
}

function injectAuthHints(state: GraphState): string {
    const mcpAuthStatus = (state.mcpAuthStatus ?? {}) as Record<string, boolean>;
    const unauthorized = Object.entries(mcpAuthStatus)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);
    if (unauthorized.length === 0) return "";
    return (
        `\n\nNOTE: The following external services require user authorization ` +
        `and are currently unavailable: ${unauthorized.join(", ")}. ` +
        `Agents that depend solely on these services may have limited capabilities.`
    );
}

async function extractAndCompressHistory(
    state: GraphState,
    sup: OrchidSupervisorConfig,
    chatModel: ChatModelLike | null,
    memory: OrchidConversationMemory | null,
    opts: { auth?: OrchidAuthContext | null } = {},
): Promise<Array<Record<string, unknown>>> {
    let history = OrchidAgent.extractConversationHistory(state as any, {
        maxTurns: sup.historyMaxTurns,
        maxChars: sup.historyMaxChars,
        truncationStrategy: (sup.memory as Record<string, unknown>)?.truncationStrategy as
            | string
            | undefined,
    });

    if (history.length > 0 && sup.historySummaryEnabled && chatModel) {
        let runningSummary: string | null = null;
        if (memory && sup.memory.strategy !== "none") {
            const chatId = state.chatId ?? "";
            if (chatId) {
                try {
                    runningSummary = await (memory as any).getRunningSummary?.(chatId);
                } catch {
                    // Silently ignore
                }
            }
        }
        history = await OrchidAgent.compressConversationHistory(history, chatModel, {
            recentTurns: sup.historySummaryRecentTurns,
            runningSummary: runningSummary ?? undefined,
            structuredOutput: sup.memory.structuredOutput,
        });

        if (memory && sup.memory.strategy !== "none") {
            const chatId = state.chatId ?? "";
            if (chatId) {
                try {
                    const visibleHistory = history.filter(
                        (m) => !m.content.startsWith("[Conversation summary]"),
                    );
                    await (memory as any).updateRunningSummary?.(
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

    // RAG-augmented retrieval (Phase 3)
    if (memory && sup.memory.strategy === "rag_augmented") {
        const chatId = state.chatId ?? "";
        if (chatId) {
            const userQuery = OrchidAgent.extractUserQuery(state as any);
            if (userQuery) {
                try {
                    const tenantId = opts.auth?.tenantKey ?? "default";
                    const userId = opts.auth?.userId ?? "";
                    if (typeof (memory as any).getRelevantHistoryMerged === "function") {
                        history = await (memory as any).getRelevantHistoryMerged({
                            query: userQuery,
                            chatId,
                            recentVerbatim: history,
                            tenantId,
                            userId,
                            k: sup.memory.ragK,
                            similarityThreshold: sup.memory.ragSimilarityThreshold,
                        });
                    }
                } catch {
                    // Silently ignore
                }
            }
        }
    }

    return history.filter(
        (m) => !m.content.startsWith("[Conversation summary]"),
    ) as unknown as Array<Record<string, unknown>>;
}

function validateSkillActivation(
    skillName: string,
    skills: Record<string, OrchidOrchestratorSkillConfig>,
    agentDescriptions: Record<string, string>,
): Partial<GraphState> | null {
    if (!(skillName in skills)) {
        console.warn("[supervisor] Unknown skill '%s', falling back to agent routing", skillName);
        return null;
    }

    const skill = skills[skillName];
    const skillAgents = (skill.steps ?? []).map((s) => s.agent);
    const skillInstructionsMap: Record<string, string> = {};
    for (const step of skill.steps ?? []) {
        if (step.instruction) {
            skillInstructionsMap[step.agent] = step.instruction;
        }
    }

    const validSkillAgents = skillAgents.filter((a) => a in agentDescriptions);
    if (validSkillAgents.length === 0) {
        const fallback = `Skill '${skillName}' references unknown agents.`;
        return {
            messages: [{ role: "ai", content: fallback }] as unknown[],
            finalResponse: fallback,
            activeAgents: [],
            pendingAgents: [],
        };
    }

    const [first, ...rest] = validSkillAgents;
    console.info(
        "[supervisor] orchestrator skill '%s': %s",
        skillName,
        [first, ...rest].join(" → "),
    );
    return {
        activeAgents: [first],
        pendingAgents: rest,
        executionMode: "sequential" as const,
        skillInstructions: skillInstructionsMap,
        messages: [
            {
                role: "ai",
                content: `[Supervisor] Skill '${skillName}': ${[first, ...rest].join(" → ")}`,
            },
        ] as unknown[],
    };
}

function recoverAgentNames(reasoning: string, agentDescriptions: Record<string, string>): string[] {
    const reasoningLower = reasoning.toLowerCase();
    const recovered: string[] = [];
    for (const name of Object.keys(agentDescriptions)) {
        if (reasoningLower.includes(name)) {
            recovered.push(name);
        }
    }
    if (recovered.length > 0) {
        console.warn(
            "[supervisor] Recovered agent names from reasoning: %s (original agents list was empty)",
            recovered,
        );
    }
    return recovered;
}

async function routePhase(
    state: GraphState,
    _model: string,
    agentDescriptions: Record<string, string>,
    orchestratorSkills: Record<string, OrchidOrchestratorSkillConfig> | null = null,
    supervisorConfig: OrchidSupervisorConfig | null = null,
    chatModel: ChatModelLike | null = null,
    memory: OrchidConversationMemory | null = null,
    opts: { auth?: OrchidAuthContext | null } = {},
): Promise<Partial<GraphState>> {
    const descText = Object.entries(agentDescriptions)
        .map(([name, desc]) => `- **${name}**: ${desc}`)
        .join("\n");

    const skills = orchestratorSkills ?? {};
    const skillText =
        Object.keys(skills).length > 0
            ? Object.entries(skills)
                  .map(([name, skill]) => `- "${name}": ${skill.description}`)
                  .join("\n")
            : "(none defined)";

    const sup = supervisorConfig ?? ({} as OrchidSupervisorConfig);
    const routingTemplate: string = sup.routingSystemPrompt ?? ROUTING_SYSTEM_PROMPT;

    const authHint = injectAuthHints(state);

    const system = routingTemplate
        .replace("{assistant_name}", sup.assistantName ?? "assistant")
        .replace("{agent_descriptions}", descText + authHint)
        .replace("{skill_descriptions}", skillText);

    const cleanHistory = await extractAndCompressHistory(state, sup, chatModel, memory, opts);

    const llmMessages: Array<Record<string, unknown>> = [{ role: "system", content: system }];
    if (cleanHistory.length > 0) {
        llmMessages.push(...cleanHistory);
    }

    const userQuery = OrchidAgent.extractUserQuery(state as any);
    if (userQuery) {
        llmMessages.push({ role: "user", content: userQuery });
    }

    let decision: OrchidRoutingDecision;
    try {
        if (!chatModel) {
            throw new Error(
                "Supervisor requires a chat model. Pass chatModel when building the graph.",
            );
        }

        const structuredModel = chatModel as any;
        if (typeof structuredModel.withStructuredOutput !== "function") {
            // Fallback: invoke and parse manually
            const result = await structuredModel.ainvoke(llmMessages, { temperature: 0.0 });
            const rawText = result.content ?? "";
            try {
                decision = OrchidRoutingDecisionSchema.parse(JSON.parse(rawText));
            } catch {
                decision = {
                    reasoning: "",
                    execution: "parallel",
                    agents: [],
                    skill: null,
                    directResponse: "Sorry, I could not understand the routing decision.",
                };
            }
        } else {
            const structured = structuredModel.withStructuredOutput(OrchidRoutingDecisionSchema);
            const result = await structured.invoke(llmMessages, { temperature: 0.0 });
            decision = OrchidRoutingDecisionSchema.parse(result);
        }

        console.info("[supervisor] routing decision: %s", JSON.stringify(decision));
    } catch (exc: unknown) {
        const errorMsg = String(exc instanceof Error ? exc.message : exc);
        console.error("[supervisor] LLM API error during routing: %s", errorMsg);

        let responseText: string;
        if (errorMsg.includes("503") || errorMsg.toLowerCase().includes("high demand")) {
            responseText =
                "I'm currently experiencing high demand and cannot process your request. Please try again in a few moments.";
        } else if (errorMsg.toLowerCase().includes("rate limit")) {
            responseText = "I've hit my rate limit. Please try again in a few moments.";
        } else {
            responseText = `I encountered an error: ${errorMsg.slice(0, 200)}. Please try again later.`;
        }

        return {
            messages: [{ role: "ai", content: responseText }] as unknown[],
            finalResponse: responseText,
            activeAgents: [],
            pendingAgents: [],
        };
    }

    const agents: string[] = decision.agents;
    const direct: string | null = decision.directResponse;
    const execution: string = decision.execution;

    // Orchestrator skill activation
    if (execution === "skill") {
        const skillResult = validateSkillActivation(
            decision.skill ?? "",
            orchestratorSkills ?? {},
            agentDescriptions,
        );
        if (skillResult !== null) return skillResult;
        // Fall through — skill name was unknown, try agent routing
    }

    // Direct response (no sub-agent needed)
    if (direct && agents.length === 0) {
        return {
            messages: [{ role: "ai", content: direct }] as unknown[],
            finalResponse: direct,
            activeAgents: [],
            pendingAgents: [],
        };
    }

    // Validate agent names
    let valid = agents.filter((a) => a in agentDescriptions);

    // Recovery: if the LLM returned empty agents but mentioned agent names in reasoning
    if (valid.length === 0 && !direct) {
        valid = recoverAgentNames(decision.reasoning, agentDescriptions);
    }

    if (valid.length === 0) {
        const fallback =
            "I'm not sure how to help with that request. Could you rephrase or provide more details?";
        return {
            messages: [{ role: "ai", content: fallback }] as unknown[],
            finalResponse: fallback,
            activeAgents: [],
            pendingAgents: [],
        };
    }

    // Dispatch based on execution mode
    if (execution === "sequential" && valid.length > 1) {
        const [first, ...rest] = valid;
        console.info("[supervisor] sequential pipeline: %s → then %s", first, rest);
        return {
            activeAgents: [first],
            pendingAgents: rest,
            executionMode: "sequential" as const,
            finalResponse: null,
            messages: [
                { role: "ai", content: `[Supervisor] Sequential pipeline: ${valid.join(" → ")}` },
            ] as unknown[],
        };
    } else {
        console.info("[supervisor] parallel dispatch: %s", valid);
        return {
            activeAgents: valid,
            pendingAgents: [],
            executionMode: "parallel" as const,
            finalResponse: null,
            messages: [
                { role: "ai", content: `[Supervisor] Parallel dispatch: ${valid.join(", ")}` },
            ] as unknown[],
        };
    }
}

export function createSupervisorNode(opts: {
    model: string;
    agentDescriptions: Record<string, string>;
    chatModel?: ChatModelLike | null;
    orchestratorSkills?: Record<string, OrchidOrchestratorSkillConfig> | null;
    supervisorConfig?: OrchidSupervisorConfig | null;
    routingChatModel?: ChatModelLike | null;
    memory?: OrchidConversationMemory | null;
}): (state: GraphState, config?: Record<string, unknown>) => Promise<Partial<GraphState>> {
    const {
        model,
        agentDescriptions,
        chatModel = null,
        orchestratorSkills = null,
        supervisorConfig = null,
        routingChatModel = null,
        memory = null,
    } = opts;

    const skills = orchestratorSkills ?? {};
    const supConfig = supervisorConfig ?? ({} as OrchidSupervisorConfig);
    const routeChatModel = routingChatModel ?? chatModel;

    const advancer = new SequentialAdvancer({
        model,
        agentDescriptions,
        supervisorConfig: supConfig,
        chatModel: routeChatModel,
        memory,
    });
    const synthesizer = new ResponseSynthesizer({
        model,
        supervisorConfig: supConfig,
        chatModel,
        memory,
    });

    async function supervisorNode(
        state: GraphState,
        config?: Record<string, unknown>,
    ): Promise<Partial<GraphState>> {
        const auth = authFromConfig(config);
        const pending = state.pendingAgents ?? [];
        const produced = currentTurnHasAgentOutput(state);

        // Case 1: Sequential pipeline in progress — advance to next agent
        if (pending.length > 0 && produced) {
            console.info(
                "[supervisor] phase=advance_sequential next=%s pending=%s",
                pending[0],
                pending.slice(1),
            );
            return await advancer.advance(state, pending);
        }

        // Case 2: All agents done (no pending) + data collected — synthesise
        if (produced && pending.length === 0 && (state.activeAgents ?? []).length === 0) {
            const mcpKeys = Object.keys(state.mcpContext ?? {});
            console.info("[supervisor] phase=synthesise (mcp_keys=%s)", mcpKeys);
            return await synthesizer.synthesise(state, { auth });
        }

        // Case 3: First entry — analyse intent and route
        console.info("[supervisor] phase=route (initial intent analysis)");
        const result = await routePhase(
            state,
            model,
            agentDescriptions,
            skills,
            supConfig,
            routeChatModel,
            memory,
            { auth },
        );
        console.info(
            "[supervisor] phase=route done (active=%s pending=%s)",
            result.activeAgents ?? [],
            result.pendingAgents ?? [],
        );
        return result;
    }

    return supervisorNode;
}

export function routeToAgents(
    state: GraphState,
): Array<{ node: string; args: GraphState }> | string {
    const active: string[] = state.activeAgents ?? [];

    if (active.length > 0) {
        const mode = state.executionMode ?? "parallel";
        if (mode === "parallel") {
            console.info("[Route] parallel dispatch → %s", active);
            // Use Send-like objects for fan-out
            return active.map((agent) => ({
                node: `${agent}_agent`,
                args: state,
            }));
        }
        console.info("[Route] sequential dispatch → %s", active[0]);
        return `${active[0]}_agent`;
    }

    if (state.finalResponse != null) {
        if (state.hasOutputGuardrails) return "output_guardrails";
        return "__end__";
    }

    if ((state.pendingAgents ?? []).length > 0) {
        return "supervisor";
    }
    if (state.hasOutputGuardrails) return "output_guardrails";
    return "__end__";
}
