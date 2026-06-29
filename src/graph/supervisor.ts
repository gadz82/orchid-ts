import { z } from "zod";
import { Send } from "@langchain/langgraph";
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
        const m = messages[i];
        const t = typeof m["type"] === "string" ? m["type"] : m["role"];
        if (t === "human" || t === "user") lastHuman = i;
    }

    for (const msg of messages.slice(lastHuman + 1)) {
        const t = typeof msg["type"] === "string" ? msg["type"] : msg["role"];
        if (t !== "ai" && t !== "assistant") continue;
        const content = String(msg["content"] ?? "");
        // Match any `[X Agent]` prefix. The agent wraps its content in
        // `[Basketball Agent] …` (or with a `\n` separator before the
        // body). Accept both shapes — `[Agent]` alone is enough to
        // disambiguate from supervisor messages which use
        // `[Supervisor] …`.
        if (content.startsWith("[") && /\[.+\sAgent\]/.test(content)) {
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

/**
 * Fallback routing path: call the model with `ainvoke` and try to parse
 * the raw content as a JSON `OrchidRoutingDecision`. Used when
 * `withStructuredOutput` fails (e.g. Ollama / local models that don't
 * reliably emit tool calls).
 */
async function invokeAndParseManually(
    structuredModel: { invoke?: (...args: unknown[]) => Promise<unknown> | unknown; baseUrl?: string },
    llmMessages: Array<Record<string, unknown>>,
    validAgentNames: Set<string>,
): Promise<OrchidRoutingDecision> {
    let rawText = "";
    let usedDirectFetch = false;

    // When an ollama baseUrl is available, prefer a direct HTTP call
    // with `format` set to the routing JSON schema so the API enforces
    // structured output. This is far more reliable for small local
    // models than relying on prompt instructions alone.
    if (structuredModel.baseUrl) {
        try {
            const baseUrl = structuredModel.baseUrl.replace(/\/+$/, "");
            const modelName = (structuredModel as { model?: string }).model ?? "llama3.2";
            const fetchResp = await fetch(`${baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: modelName,
                    messages: llmMessages,
                    stream: false,
                    format: {
                        type: "object",
                        properties: {
                            reasoning: { type: "string" },
                            execution: {
                                type: "string",
                                enum: ["parallel", "sequential", "skill"],
                            },
                            agents: { type: "array", items: { type: "string" } },
                            skill: { type: ["string", "null"] },
                            directResponse: { type: ["string", "null"] },
                        },
                        required: ["reasoning", "execution", "agents", "skill", "directResponse"],
                    },
                }),
            });
            if (fetchResp.ok) {
                const fetchBody = (await fetchResp.json()) as {
                    message?: { content?: string };
                };
                rawText = fetchBody.message?.content ?? "";
                usedDirectFetch = true;
            }
        } catch (err) {
            console.warn(
                "[supervisor] direct Ollama fetch failed: %s",
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    // Fall back to LangChain's invoke() for non-Ollama models or if
    // the direct fetch returned empty.
    if (!rawText.trim()) {
        try {
            if (typeof structuredModel.invoke !== "function") {
                throw new Error("chat model has no invoke()");
            }
            const invokeFn = structuredModel.invoke.bind(structuredModel);
            const result = (await invokeFn(llmMessages)) as { content?: unknown };
            rawText = typeof result?.content === "string" ? result.content : "";
        } catch (err) {
            const errObj = err instanceof Error ? err : new Error(String(err));
            console.warn(
                "[supervisor] invoke() failed: %s",
                errObj.message,
            );
            if (!rawText.trim()) {
                throw errObj;
            }
        }
    }

    if (usedDirectFetch) {
        console.warn(
            "[supervisor] used direct Ollama fetch, rawText (first 200): %s",
            rawText.slice(0, 200),
        );
    }
    try {
        // Try strict JSON first.
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return OrchidRoutingDecisionSchema.parse(JSON.parse(jsonMatch[0]));
        }
    } catch {
        // Fall through to YAML-ish parser below
    }

    // Many local models (Ollama llama3.2, etc.) respond with YAML-ish
    // key/value text rather than strict JSON. Some models wrap field
    // names in incomplete markdown bold markers (e.g. **agents**: or
    // **agents:**). Strip those before extracting fields with the
    // permissive regex so both `agents:` and `**Agents:**` are matched.
    //
    // The colon can be missing — some models output `field\nvalue`
    // instead of `field: value`.
    const strippedText = rawText.replace(/\*{1,2}([a-zA-Z_]+)\*{0,2}\s*:?/g, "$1:");
    const pickField = (name: string, source: string = strippedText): string | null => {
        // Pattern 1: `field: value` (single line, colon present)
        let m = source.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*:\\s*([^\\n]+)`, "i"));
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        // Pattern 2: `field:\nmultiline value`
        m = source.match(
            new RegExp(`(?:^|\\n)\\s*${name}\\s*:\\s*\\n([\\s\\S]*?)(?=\\n[a-zA-Z_]+\\s*:?|$)`, "i"),
        );
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        // Pattern 3: `field\nvalue` (no colon)
        m = source.match(
            new RegExp(`(?:^|\\n)\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n[a-zA-Z_]+\\s*:?|$)`, "i"),
        );
        return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
    };
    const agentsRaw = pickField("agents") ?? pickField("agent");
    const executionRaw = pickField("execution");
    const reasoningRaw = pickField("reasoning") ?? pickField("reason");
    const directRaw = pickField("directResponse") ?? pickField("response");

    const agents = (agentsRaw ?? "")
        .replace(/[[\]"]/g, "")  // strip brackets AND any double-quotes
        .split(/[,\s]+/)
        .map((s) => s.trim().replace(/^['"]+|['"]+$/g, ""))  // strip any remaining quotes (single or double)
        .filter((s) => s && validAgentNames.has(s));

    const execution: OrchidRoutingDecision["execution"] =
        executionRaw === "sequential" ? "sequential" : "parallel";

    let direct: string | null = directRaw ?? null;
    if (direct && /^(null|none)$/i.test(direct.trim())) {
        direct = null;
    }

    if (agents.length > 0 || direct) {
        return {
            reasoning: reasoningRaw ?? "",
            execution,
            agents,
            skill: null,
            directResponse: direct,
        };
    }

    // Last resort: surface the raw model text as a direct response so
    // the user sees *something* instead of a generic error.
    return {
        reasoning: "",
        execution: "parallel",
        agents: [],
        skill: null,
        directResponse: rawText?.slice(0, 500) || "Sorry, I could not understand the routing decision.",
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
        // Always use the manual parse path. The `withStructuredOutput` path
        // (which works for OpenAI / Anthropic / Gemini) is unreliable for
        // Ollama / local models — they respond with YAML-ish text rather
        // than the tool-call format `withStructuredOutput` expects, AND
        // the failed `withStructuredOutput` call appears to leave the
        // underlying chat model in a state where a follow-up `invoke()`
        // returns empty content. The manual parse is more robust and
        // handles both JSON and YAML-ish responses.
        decision = await invokeAndParseManually(
            structuredModel,
            llmMessages,
            new Set(Object.keys(agentDescriptions)),
        );

        console.info("[supervisor] routing decision: %s", JSON.stringify(decision));
    } catch (exc: unknown) {
        const errorMsg = String(exc instanceof Error ? exc.message : exc);
        const errorStack = exc instanceof Error ? exc.stack : undefined;
        const cause = exc instanceof Error ? (exc as Error & { cause?: unknown }).cause : undefined;
        console.error("[supervisor] LLM API error during routing: %s", errorMsg);
        if (errorStack) console.error("[supervisor] stack:", errorStack.split("\n").slice(0, 8).join("\n"));
        if (cause) {
            const causeMsg = cause instanceof Error ? cause.message : String(cause);
            const causeCode = (cause as { code?: string }).code;
            console.error("[supervisor] cause:", causeMsg, "code:", causeCode);
        }

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
): Array<{ node: string; args: GraphState } | Send> | Send | string {
    const active: string[] = state.activeAgents ?? [];

    if (active.length > 0) {
        const mode = state.executionMode ?? "parallel";
        if (mode === "parallel") {
            console.info("[Route] parallel dispatch → %s", active);
            // LangGraph's parallel fan-out requires actual `Send` instances
            // (not plain objects). The pregel algo checks `instanceof Send`
            // and throws `InvalidUpdateError("Invalid packet type, expected
            // SendProtocol")` if the value is a duck-typed plain object.
            return active.map((agent) => new Send(`${agent}_agent`, state));
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
