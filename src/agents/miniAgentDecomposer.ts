/**
 * Mini-agent decomposition step.
 *
 * Port of orchid/orchid_ai/agents/mini_agent_decomposer.py
 *
 * The decomposer is a deterministic structured-output LLM call that
 * decides whether the parent agent's current request can be split into
 * two-or-more INDEPENDENT sub-tasks suitable for parallel mini-agent
 * execution.
 */

import { z } from "zod";
import type { ChatModelLike, OrchidAuthContext } from "../core/index.js";
import type { OrchidAgentConfig } from "../config/schema/index.js";

// ── Default decomposition prompt ─────────────────────────────────

export const DEFAULT_DECOMPOSER_PROMPT = `\
You are the decomposition step for the "{agent_name}" agent.
Agent description: {agent_description}
Agent prompt: {agent_prompt}
Available tools: {tool_inventory}

The user has asked: {user_query}
Conversation history (last {history_max_turns} turns): {history}

Decide whether this request decomposes into INDEPENDENT sub-tasks that
can be processed in parallel by separate mini-agents. A sub-task is
INDEPENDENT iff:
  - it can begin without the result of any other sub-task
  - completing it requires its own multi-step tool-calling loop
    (a single tool call should usually NOT be a mini-agent — that
     belongs in parallel_tools)

If the request is already a single coherent task, return should_fork=false.
Otherwise emit 2..{max_count} sub-tasks. For each sub-task:
  - id: "mini_0", "mini_1", ...
  - description: short user-facing label (≤ 80 chars)
  - instruction: focused system-prompt suffix appended to the agent's prompt
  - allowed_tools: minimal subset of available tools needed for this sub-task
  - rationale: one sentence explaining independence`;

// ── Zod schemas for structured output ────────────────────────────

export const MiniAgentSubTaskSchema = z.object({
    id: z.string().describe('Stable identifier, e.g. "mini_0".'),
    description: z.string().describe("Short user-facing label (≤ 80 chars)."),
    instruction: z
        .string()
        .describe("Focused system-prompt suffix appended to the agent's prompt."),
    allowedTools: z
        .array(z.string())
        .default([])
        .describe("Minimal subset of tools the sub-task may call."),
    rationale: z.string().describe("One sentence explaining why this sub-task is independent."),
});
export type MiniAgentSubTask = z.infer<typeof MiniAgentSubTaskSchema>;

export const MiniAgentDecompositionSchema = z
    .object({
        shouldFork: z
            .boolean()
            .describe("True iff the request decomposes into independent sub-tasks."),
        subTasks: z
            .array(MiniAgentSubTaskSchema)
            .default([])
            .describe("0 if should_fork=false; otherwise 2..max_count entries."),
        reasoning: z.string().default("").describe("Debug-only explanation surfaced in the trace."),
    })
    .superRefine((val, ctx) => {
        if (!val.shouldFork) {
            if (val.subTasks.length > 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "MiniAgentDecomposition: shouldFork=false but subTasks is non-empty",
                });
            }
            return;
        }
        if (val.subTasks.length < 2) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "MiniAgentDecomposition: shouldFork=true requires at least 2 sub-tasks",
            });
            return;
        }
        const seenIds = new Set<string>();
        for (const st of val.subTasks) {
            if (seenIds.has(st.id)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `MiniAgentDecomposition: duplicate sub_task id '${st.id}'`,
                });
                return;
            }
            seenIds.add(st.id);
        }
    });

export type MiniAgentDecomposition = z.infer<typeof MiniAgentDecompositionSchema>;

// ── Error class ──────────────────────────────────────────────────

export class MiniAgentDecompositionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MiniAgentDecompositionError";
    }
}

// ── The decomposer ───────────────────────────────────────────────

export class MiniAgentDecomposer {
    private agentConfig: OrchidAgentConfig;
    private chatModel: ChatModelLike;

    constructor(opts: { agentConfig: OrchidAgentConfig; chatModel: ChatModelLike }) {
        this.agentConfig = opts.agentConfig;
        this.chatModel = opts.chatModel;
    }

    async decompose(opts: {
        userQuery: string;
        conversationHistory?: Array<{ role: string; content: string }> | null;
        toolInventory: string[];
        historyMaxTurns?: number;
        maxCount?: number;
    }): Promise<MiniAgentDecomposition> {
        const promptTemplate =
            this.agentConfig.miniAgent.decomposerPrompt || DEFAULT_DECOMPOSER_PROMPT;
        const maxCount = opts.maxCount ?? this.agentConfig.miniAgent.maxCount;

        const rendered = promptTemplate
            .replace(/\{agent_name\}/g, this.agentConfig.name)
            .replace(/\{agent_description\}/g, this.agentConfig.description)
            .replace(/\{agent_prompt\}/g, this.agentConfig.prompt)
            .replace(
                /\{tool_inventory\}/g,
                opts.toolInventory.length > 0 ? opts.toolInventory.join(", ") : "(none)",
            )
            .replace(/\{user_query\}/g, opts.userQuery)
            .replace(/\{history\}/g, renderHistory(opts.conversationHistory ?? null))
            .replace(/\{history_max_turns\}/g, String(opts.historyMaxTurns ?? 20))
            .replace(/\{max_count\}/g, String(maxCount));

        // Call model with structured output
        let structuredLlm: any;
        try {
            structuredLlm = (this.chatModel as any).withStructuredOutput
                ? (this.chatModel as any).withStructuredOutput(MiniAgentDecompositionSchema)
                : (this.chatModel as any).bindTools
                  ? (this.chatModel as any).bindTools([
                        {
                            type: "function",
                            function: {
                                name: "MiniAgentDecomposition",
                                description: "Decomposition decision",
                                parameters: zodToJsonSchema(MiniAgentDecompositionSchema),
                            },
                        },
                    ])
                  : null;
        } catch {
            // If withStructuredOutput / bindTools aren't available, fallback to
            // a raw invoke and JSON-parse the content.
            structuredLlm = null;
        }

        let decomposition: MiniAgentDecomposition;
        if (structuredLlm !== null) {
            const result = await structuredLlm.invoke([{ role: "system", content: rendered }]);

            // If the model returned a tool call (bindTools path), unwrap it
            if (isStructuredOutputTool(result)) {
                decomposition = MiniAgentDecompositionSchema.parse(
                    JSON.parse(result.tool_calls?.[0]?.function?.arguments ?? "{}"),
                );
            } else if (typeof result === "object" && result !== null && "shouldFork" in result) {
                // Direct structured output path
                decomposition = MiniAgentDecompositionSchema.parse(result);
            } else {
                // Fallback: parse content as JSON
                const content =
                    typeof result.content === "string" ? result.content : JSON.stringify(result);
                decomposition = MiniAgentDecompositionSchema.parse(JSON.parse(content));
            }
        } else {
            // No structured output support — raw invoke and JSON-parse
            const result = await this.chatModel.invoke([{ role: "system", content: rendered }]);
            const jsonMatch = (result.content ?? "").match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new MiniAgentDecompositionError("Decomposer did not return valid JSON");
            }
            decomposition = MiniAgentDecompositionSchema.parse(JSON.parse(jsonMatch[0]));
        }

        // Cap sub-task count to per-agent maxCount
        if (decomposition.subTasks.length > maxCount) {
            throw new MiniAgentDecompositionError(
                `decomposer returned ${decomposition.subTasks.length} sub-tasks but ` +
                    `maxCount is ${maxCount} for agent '${this.agentConfig.name}'`,
            );
        }

        if (decomposition.shouldFork) {
            this.enforceToolAllowlist(decomposition, opts.toolInventory);
        }

        return decomposition;
    }

    resolveToolSubset(opts: { subTask: MiniAgentSubTask; toolInventory: string[] }): string[] {
        const mode = this.agentConfig.miniAgent.toolAllowlistMode;
        if (mode === "parent_full") {
            return [...opts.toolInventory];
        }
        if (mode === "inferred" && opts.subTask.allowedTools.length === 0) {
            return [...opts.toolInventory];
        }
        return [...opts.subTask.allowedTools];
    }

    private enforceToolAllowlist(
        decomposition: MiniAgentDecomposition,
        toolInventory: string[],
    ): void {
        const mode = this.agentConfig.miniAgent.toolAllowlistMode;
        const inventory = new Set(toolInventory);

        if (mode === "parent_full") return;

        for (const subTask of decomposition.subTasks) {
            if (subTask.allowedTools.length === 0) {
                if (mode === "inferred") {
                    console.warn(
                        `[${this.agentConfig.name}] mini-agent '${subTask.id}' has empty allowedTools — ` +
                            `falling back to full parent inventory (inferred mode)`,
                    );
                    continue;
                }
                // strict mode forbids empty
                throw new MiniAgentDecompositionError(
                    `sub_task '${subTask.id}' has empty allowedTools but ` +
                        `toolAllowlistMode='strict' (agent '${this.agentConfig.name}')`,
                );
            }

            const unknown = subTask.allowedTools.filter((t) => !inventory.has(t));
            if (unknown.length > 0) {
                throw new MiniAgentDecompositionError(
                    `sub_task '${subTask.id}' references unknown tools ${JSON.stringify(unknown)} ` +
                        `not in parent '${this.agentConfig.name}' inventory`,
                );
            }
        }
    }
}

// ── Free function: maybeDecompose ────────────────────────────────

export async function maybeDecompose(opts: {
    agentConfig: OrchidAgentConfig;
    chatModel: ChatModelLike;
    mcpClients: any[];
    auth: OrchidAuthContext;
    state: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
    const { agentConfig, chatModel, mcpClients, auth, state } = opts;

    if (!agentConfig.miniAgent.enabled) return null;
    if (!chatModel) return null;

    // Build decomposer chat model: parent's by default, overridden
    // when mini_agent.decomposerModel differs from parent's llm.model.
    let decomposerChat = chatModel;
    const parentModel = (agentConfig.llm?.model as string) ?? "";
    const decomposerModel = agentConfig.miniAgent.decomposerModel;
    if (decomposerModel && decomposerModel !== parentModel) {
        // Dynamic import — llmFactory is a future module; fallback is safe.
        try {
            // @ts-expect-error — ../llmFactory.js is not yet built
            const { buildChatModel } = await import("../llmFactory.js");
            decomposerChat = await buildChatModel(decomposerModel, { temperature: 0 });
        } catch (exc: unknown) {
            console.warn(
                `[${agentConfig.name}] decomposer: cannot build overridden model '${decomposerModel}': ${exc} — using parent model`,
            );
        }
    }

    // Render parent's full tool inventory
    let inventory: string[] = [];
    try {
        inventory = await renderToolInventory({
            agentConfig,
            mcpClients,
            auth,
        });
    } catch (exc: unknown) {
        console.warn(
            `[${agentConfig.name}] decomposer: tool inventory rendering failed (${exc}) — running without tools list`,
        );
    }

    // Extract history + user query via static OrchidAgent helpers
    const { extractUserQuery, extractConversationHistory } = await import("../core/helpers.js");
    const history = extractConversationHistory(state as any);
    const userQuery = extractUserQuery(state as any);

    const decomposer = new MiniAgentDecomposer({
        agentConfig,
        chatModel: decomposerChat,
    });

    let decomposition: MiniAgentDecomposition;
    try {
        decomposition = await decomposer.decompose({
            userQuery,
            conversationHistory: history,
            toolInventory: inventory,
        });
    } catch (exc: unknown) {
        if (exc instanceof MiniAgentDecompositionError) {
            console.warn(
                `[${agentConfig.name}] decomposer rejected: ${exc.message} — short-circuiting with error AIMessage`,
            );
            return {
                messages: [
                    {
                        type: "ai",
                        content: `[${capitalize(agentConfig.name)} Agent] I couldn't break this request into independent sub-tasks: ${exc.message}`,
                        name: agentConfig.name,
                    },
                ],
                mcpContext: { [agentConfig.name]: { summary: String(exc) } },
            };
        }
        console.warn(
            `[${agentConfig.name}] decomposer LLM call failed (${exc}) — falling back to normal flow`,
        );
        return null;
    }

    if (!decomposition.shouldFork) {
        console.info(
            `[${agentConfig.name}] decomposer: shouldFork=false (${(decomposition.reasoning || "").slice(0, 120) || "(no reason given)"})`,
        );
        return null;
    }

    // Resolve per-sub-task tool subsets
    const subTaskPayloads: Array<Record<string, unknown>> = [];
    for (const subTask of decomposition.subTasks) {
        const toolSubset = decomposer.resolveToolSubset({
            subTask,
            toolInventory: inventory,
        });
        subTaskPayloads.push({
            ...MiniAgentSubTaskSchema.parse(subTask),
            resolvedToolSubset: toolSubset,
        });
    }

    const decisionDump = {
        shouldFork: decomposition.shouldFork,
        subTasks: subTaskPayloads,
        reasoning: decomposition.reasoning,
    };

    console.info(
        `[${agentConfig.name}] decomposer: shouldFork=true (${decomposition.subTasks.length} sub-tasks)`,
    );

    // Emit mini_agent.decomposed event
    const event = makeEventMessage("mini_agent.decomposed", {
        parent: agentConfig.name,
        count: decomposition.subTasks.length,
        subTasks: decomposition.subTasks.map((s) => ({
            id: s.id,
            description: s.description,
        })),
    });

    return {
        miniAgentDecisions: { [agentConfig.name]: decisionDump },
        messages: [event],
    };
}

// ── Helpers ──────────────────────────────────────────────────────

async function renderToolInventory(opts: {
    agentConfig: OrchidAgentConfig;
    mcpClients: any[];
    auth: OrchidAuthContext;
}): Promise<string[]> {
    const { agentConfig, mcpClients, auth } = opts;
    const names: string[] = [];
    const seen = new Set<string>();

    // Built-in tools that survive registry lookup
    const { getTool } = await import("../config/toolRegistry.js");
    for (const toolName of agentConfig.tools) {
        try {
            getTool(toolName);
        } catch {
            continue;
        }
        if (!seen.has(toolName)) {
            names.push(toolName);
            seen.add(toolName);
        }
    }

    // MCP tools — declared and discovered
    if (agentConfig.mcpServers.length > 0 && mcpClients.length > 0) {
        const { MCPDispatcher } = await import("./mcpDispatcher.js");
        const dispatcher = new MCPDispatcher(mcpClients, agentConfig.mcpServers);
        const caps = await dispatcher.renderCapabilities(auth, {
            agentName: agentConfig.name,
        });
        for (const raw of caps.rawTools) {
            const toolName = raw.name as string;
            if (toolName && !seen.has(toolName)) {
                names.push(toolName);
                seen.add(toolName);
            }
        }
    }

    return names;
}

function renderHistory(history: Array<{ role: string; content: string }> | null): string {
    if (!history || history.length === 0) return "(no prior turns)";
    const lines: string[] = [];
    for (const msg of history) {
        const role = msg.role ?? "?";
        const content = msg.content ?? "";
        if (!content) continue;
        lines.push(`- ${role}: ${content}`);
    }
    return lines.length > 0 ? lines.join("\n") : "(no prior turns)";
}

function capitalize(s: string): string {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build a system message carrying a mini-agent lifecycle event.
 *
 * Mirrors Python's `make_event_message` — uses `additional_kwargs`
 * so the streaming router can extract and re-emit as SSE frames.
 */
function makeEventMessage(
    eventName: string,
    data: Record<string, unknown>,
): Record<string, unknown> {
    return {
        type: "system",
        content: "",
        additional_kwargs: { orchid_event: eventName, data },
    };
}

/**
 * Check if the LLM response is a structured-output tool_call (bindTools path).
 */
function isStructuredOutputTool(result: any): boolean {
    return (
        result !== null &&
        typeof result === "object" &&
        Array.isArray(result.tool_calls) &&
        result.tool_calls.length > 0
    );
}

/**
 * Convert a Zod schema to JSON Schema for bindTools compatibility.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    // zod-to-json-schema is an optional dep; inline a minimal conversion
    // for the MiniAgentDecompositionSchema shape.
    try {
        const shape = (schema as any)._def?.shape?.();
        if (!shape) return { type: "object", properties: {} };
        const properties: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(shape)) {
            const fieldDef = (field as any)._def;
            const fieldSchema: Record<string, unknown> = {};
            if (fieldDef?.typeName === "ZodBoolean") {
                fieldSchema.type = "boolean";
            } else if (fieldDef?.typeName === "ZodString") {
                fieldSchema.type = "string";
            } else if (fieldDef?.typeName === "ZodNumber") {
                fieldSchema.type = "number";
            } else if (fieldDef?.typeName === "ZodArray") {
                fieldSchema.type = "array";
                fieldSchema.items = zodToJsonSchema(fieldDef.type);
            } else {
                fieldSchema.type = "string";
            }
            if (fieldDef?.description) {
                fieldSchema.description = fieldDef.description;
            }
            properties[key] = fieldSchema;
        }
        return { type: "object", properties };
    } catch {
        return { type: "object", properties: {} };
    }
}
