/**
 * Mini-agent runtime node.
 *
 * Port of orchid/orchid_ai/agents/mini_agent_node.py
 *
 * A single LangGraph node, registered once per opt-in parent under the
 * name `${parentName}_mini`.  The graph's fork router fans out one
 * Send per sub-task; LangGraph runs every Send branch in parallel
 * through this same node and joins them at the aggregator.
 */

import { z } from "zod";
import type { ChatModelLike, OrchidAuthContext } from "../core/index.js";
import type { OrchidAgentConfig } from "../config/schema/index.js";

// ── Outcome model ─────────────────────────────────────────────────

export const MiniAgentOutcomeSchema = z.object({
    miniId: z.string(),
    subTaskDescription: z.string(),
    status: z.enum(["ok", "failed", "timeout"]),
    summary: z.string().nullable().default(null),
    error: z.string().nullable().default(null),
    durationMs: z.number().int().default(0),
    toolResults: z.record(z.string(), z.string()).default({}),
});

export type MiniAgentOutcome = z.infer<typeof MiniAgentOutcomeSchema>;

// ── MiniAgentRuntimeError ────────────────────────────────────────

export class MiniAgentRuntimeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MiniAgentRuntimeError";
    }
}

// ── GraphBubbleUp detection ──────────────────────────────────────

// LangGraph signals graph-control flow (interrupt for HITL, Command
// re-routing) by raising subclasses of GraphBubbleUp. These MUST
// escape the mini node's broad catch block — catching them would
// convert a legitimate suspension request into a status="failed"
// outcome.
let GRAPH_BUBBLE_UP_EXCS: readonly (new (...args: any[]) => Error)[] = [];
try {
    // Dynamic require to avoid import-time error when langgraph is optional
    const { GraphBubbleUp } = require("@langchain/langgraph");
    GRAPH_BUBBLE_UP_EXCS = [GraphBubbleUp];
} catch {
    GRAPH_BUBBLE_UP_EXCS = [];
}

function isGraphBubbleUp(exc: unknown): boolean {
    if (!(exc instanceof Error)) return false;
    for (const BCls of GRAPH_BUBBLE_UP_EXCS) {
        if (exc instanceof BCls) return true;
    }
    return false;
}

// ── Factory ──────────────────────────────────────────────────────

export function miniAgentNodeFactory(opts: {
    parentConfig: OrchidAgentConfig;
    chatModel: ChatModelLike;
    mcpClients: any[];
}): (
    state: Record<string, unknown>,
    config?: Record<string, unknown>,
) => Promise<Record<string, unknown>> {
    const parentName = opts.parentConfig.name;
    const chatModel = opts.chatModel;
    const mcpClients = opts.mcpClients;
    const timeout = opts.parentConfig.miniAgent.timeoutSeconds;

    async function miniAgentNode(
        state: Record<string, unknown>,
        config?: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const start = performance.now();

        const subTaskPayload = (state._activeMiniSubtask as Record<string, unknown>) ?? {};
        const miniId =
            (state._activeMiniId as string) || (subTaskPayload.id as string) || "mini_unknown";
        const activeParent = (state._activeMiniParent as string) || parentName;

        if (activeParent !== parentName) {
            throw new MiniAgentRuntimeError(
                `mini node for parent '${parentName}' invoked with _activeMiniParent='${activeParent}'`,
            );
        }

        const slotKey = `${parentName}#${miniId}`;
        const description = (subTaskPayload.description as string) || miniId;
        const instruction = (subTaskPayload.instruction as string) || "";
        const toolSubset: string[] =
            (state._activeMiniToolSubset as string[]) ||
            (subTaskPayload.allowedTools as string[]) ||
            [];

        // Extract auth from config
        let auth: OrchidAuthContext | null = null;
        try {
            const { authFromConfig } = await import("../core/runConfig.js");
            auth = authFromConfig((config ?? {}) as Record<string, unknown>);
        } catch {
            auth = null;
        }

        if (!auth) {
            return emitOutcome({
                parentName,
                miniId,
                description,
                status: "failed",
                error: "missing auth_context in config",
                durationMs: elapsedMs(start),
                slotKey,
            });
        }

        try {
            const outcomeDict = await runMiniWithTimeout({
                parentConfig: opts.parentConfig,
                chatModel,
                mcpClients,
                auth,
                state,
                miniId,
                description,
                instruction,
                toolSubset,
                timeout,
            });
            outcomeDict.durationMs = elapsedMs(start);
            return wrapStateUpdate(parentName, slotKey, outcomeDict);
        } catch (exc: unknown) {
            if (isGraphBubbleUp(exc)) {
                // HITL interrupt — let LangGraph catch it at the boundary
                throw exc;
            }

            if (isTimeoutError(exc)) {
                console.warn(
                    `[${parentName}/${miniId}] mini-agent exceeded timeout of ${timeout}s`,
                );
                return emitOutcome({
                    parentName,
                    miniId,
                    description,
                    status: "timeout",
                    error: `timed out after ${timeout}s`,
                    durationMs: elapsedMs(start),
                    slotKey,
                });
            }

            console.error(
                `[${parentName}/${miniId}] mini-agent raised ${(exc as any)?.constructor?.name ?? typeof exc}: ${exc}`,
                exc,
            );
            return emitOutcome({
                parentName,
                miniId,
                description,
                status: "failed",
                error: `${(exc as any)?.constructor?.name ?? typeof exc}: ${exc}`,
                durationMs: elapsedMs(start),
                slotKey,
            });
        }
    }

    // Name the closure for debugging
    Object.defineProperty(miniAgentNode, "name", {
        value: `${parentName}_mini`,
        configurable: true,
    });

    return miniAgentNode;
}

// ── Inner runner — separated for clean timeout ───────────────────

async function runMiniWithTimeout(opts: {
    parentConfig: OrchidAgentConfig;
    chatModel: ChatModelLike;
    mcpClients: any[];
    auth: OrchidAuthContext;
    state: Record<string, unknown>;
    miniId: string;
    description: string;
    instruction: string;
    toolSubset: string[];
    timeout: number;
}): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutMs = opts.timeout * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await runInnerLoop({
            ...opts,
            signal: controller.signal,
        });
    } catch (exc: unknown) {
        if (controller.signal.aborted) {
            // Re-wrap as a proper timeout error
            const timeoutError = new Error(`mini-agent timed out after ${opts.timeout}s`);
            (timeoutError as any).code = "MINI_TIMEOUT";
            throw timeoutError;
        }
        throw exc;
    } finally {
        clearTimeout(timer);
    }
}

async function runInnerLoop(opts: {
    parentConfig: OrchidAgentConfig;
    chatModel: ChatModelLike;
    mcpClients: any[];
    auth: OrchidAuthContext;
    state: Record<string, unknown>;
    miniId: string;
    description: string;
    instruction: string;
    toolSubset: string[];
    signal: AbortSignal;
}): Promise<Record<string, unknown>> {
    const {
        parentConfig,
        chatModel,
        mcpClients,
        auth,
        state,
        miniId,
        description,
        instruction,
        toolSubset,
        signal,
    } = opts;

    // Lazy imports to avoid circular deps
    const { AgenticLoop } = await import("./agenticLoop.js");
    const { MCPDispatcher } = await import("./mcpDispatcher.js");
    const { buildLangChainTools } = await import("./tools.js");
    const { toolsToLiteLLMFormat } = await import("./toolUtils.js");
    const { extractUserQuery, extractConversationHistory } = await import("../core/helpers.js");

    // Render parent's MCP capabilities
    const dispatcher = new MCPDispatcher(mcpClients, parentConfig.mcpServers);
    const caps = await dispatcher.renderCapabilities(auth, {
        agentName: `${parentConfig.name}.${miniId}`,
    });

    // Build the parent's full tool inventory and filter to the subset
    const { names: builtinToolNames, defs: builtinToolDefs } = toolsToLiteLLMFormat(
        parentConfig.tools,
    );
    const mcpToolDefs = MCPDispatcher.mcpToolsToLiteLLM(
        caps.rawTools.filter(
            (t: Record<string, unknown>) => !builtinToolNames.has(t.name as string),
        ),
    );

    let filteredBuiltin = builtinToolDefs;
    let filteredMcp = mcpToolDefs;
    const allowed = toolSubset.length > 0 ? new Set(toolSubset) : null;
    if (allowed !== null) {
        filteredBuiltin = builtinToolDefs.filter((td) =>
            allowed.has((td.function as any)?.name as string),
        );
        filteredMcp = mcpToolDefs.filter((td) => allowed.has((td.function as any)?.name as string));
    }

    const allToolDefs = [...filteredMcp, ...filteredBuiltin];

    // Build LangChain-compatible tool wrappers
    const lcTools = buildLangChainTools({
        builtinNames:
            allowed !== null
                ? new Set([...builtinToolNames].filter((n) => allowed.has(n)))
                : builtinToolNames,
        builtinToolDefs: filteredBuiltin,
        mcpToolDefs: filteredMcp,
        mcpToolClientMap: buildToolClientMap(caps.rawTools, caps.toolClientMap),
        auth,
        agentName: `${parentConfig.name}.${miniId}`,
        approvalTools: parentConfig.approvalTools
            ? new Set(parentConfig.approvalTools as string[])
            : undefined,
    });

    const toolMap = new Map(lcTools.map((t) => [t.name, t]));

    // Resolve parallel-safety inheritance from the parent
    const parallelSafety = await inheritParallelSafety({
        parentConfig,
        toolMap,
        builtinToolNames,
        caps,
    });

    // Build the focused system prompt
    const systemPrompt = buildMiniSystemPrompt({
        parentPrompt: parentConfig.prompt,
        instruction,
        toolSubset: [...toolMap.keys()],
        capsDescriptions: toolDescriptions(caps, filteredBuiltin),
        template: parentConfig.miniAgent.systemPromptTemplate,
    });

    // Build messages: system + conversation history + user query
    const messages: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }];

    const history = extractConversationHistory(state as any, {
        maxTurns: 20,
        maxChars: 1000,
    });
    for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
    }

    const userQuery = extractUserQuery(state as any);
    if (userQuery) {
        messages.push({ role: "user", content: userQuery });
    }

    // Check abort signal
    if (signal.aborted) {
        throw new Error("mini-agent aborted before loop start");
    }

    // Run the agentic loop
    const llmConfig = parentConfig.llm;
    const loop = new AgenticLoop({
        agentName: `${parentConfig.name}.${miniId}`,
        chatModel,
        toolMap,
        allToolDefs,
        temperature: llmConfig?.temperature ?? 0.2,
        parallelSafety,
        toolSubset: toolSubset.length > 0 ? toolSubset : null,
        isMini: true,
        maxToolRounds: parentConfig.maxToolRounds,
        maxConsecutiveDupes: parentConfig.maxConsecutiveDupes,
    });

    const [finalText, toolResults] = await loop.run(messages);
    const summary = finalText || fallbackSummary(toolResults as Record<string, unknown>);

    return {
        miniId,
        subTaskDescription: description,
        status: "ok",
        summary,
        error: null,
        toolResults: stringifyToolResults(toolResults as Record<string, unknown>),
    };
}

// ── Helpers ──────────────────────────────────────────────────────

function buildToolClientMap(
    _rawTools: Array<Record<string, unknown>>,
    toolClientMap: Map<string, [any, any]>,
): Map<string, { client: any; serverConfig: unknown }> {
    const result = new Map<string, { client: any; serverConfig: unknown }>();
    for (const [name, tuple] of toolClientMap) {
        result.set(name, { client: tuple[0], serverConfig: tuple[1] });
    }
    return result;
}

async function inheritParallelSafety(opts: {
    parentConfig: OrchidAgentConfig;
    toolMap: Map<string, any>;
    builtinToolNames: Set<string>;
    caps: any;
}): Promise<Record<string, boolean> | null> {
    const { resolveParallelSafety } = await import("./toolUtils.js");

    const mcpOverrides: Record<string, boolean> = {};
    for (const server of opts.parentConfig.mcpServers) {
        for (const tool of server.tools) {
            if (tool.parallelSafe !== null && tool.parallelSafe !== undefined) {
                mcpOverrides[tool.name] = tool.parallelSafe;
            }
        }
    }

    return resolveParallelSafety({
        toolMap: opts.toolMap,
        builtinToolNames: opts.builtinToolNames,
        caps: opts.caps,
        parallelToolsEnabled: opts.parentConfig.parallelTools === true,
        approvalTools: new Set<string>((opts.parentConfig.approvalTools as string[]) ?? []),
        parallelSafeBuiltinTools: new Set<string>(
            (opts.parentConfig.parallelSafeBuiltinTools as string[]) ?? [],
        ),
        mcpParallelOverrides: mcpOverrides,
    }) as Record<string, boolean> | null;
}

function buildMiniSystemPrompt(opts: {
    parentPrompt: string;
    instruction: string;
    toolSubset: string[];
    capsDescriptions: Record<string, string>;
    template: string | null | undefined;
}): string {
    let toolList = "";
    if (opts.toolSubset.length > 0) {
        const bullets = opts.toolSubset.map(
            (name) => `- ${name}: ${opts.capsDescriptions[name] || name}`,
        );
        toolList = bullets.join("\n");
    }

    if (opts.template != null) {
        return opts.template
            .replace(/\{parent_prompt\}/g, opts.parentPrompt)
            .replace(/\{instruction\}/g, opts.instruction)
            .replace(/\{tool_list\}/g, toolList);
    }

    const parts: string[] = [opts.parentPrompt];
    if (opts.instruction) {
        parts.push("\n\n" + opts.instruction);
    }
    if (toolList) {
        parts.push("\n\nTools available to you:\n" + toolList);
    }
    return parts.join("");
}

function toolDescriptions(
    caps: any,
    builtinToolDefs: Array<Record<string, unknown>>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of caps.rawTools ?? []) {
        const name = raw.name as string;
        if (name) {
            const desc = ((raw.description as string) ?? "").trim();
            out[name] = desc.split("\n")[0] || "";
        }
    }
    for (const td of builtinToolDefs) {
        const fn = td.function as Record<string, unknown> | undefined;
        if (!fn) continue;
        const name = fn.name as string;
        if (name) {
            const desc = ((fn.description as string) ?? "").trim();
            out[name] = desc.split("\n")[0] || "";
        }
    }
    return out;
}

function stringifyToolResults(toolResults: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(toolResults ?? {})) {
        if (v === null || v === undefined) {
            out[k] = "";
        } else if (typeof v === "string") {
            out[k] = v;
        } else {
            try {
                out[k] = JSON.stringify(v);
            } catch {
                out[k] = String(v);
            }
        }
    }
    return out;
}

function fallbackSummary(toolResults: Record<string, unknown>): string {
    if (!toolResults || Object.keys(toolResults).length === 0) {
        return "";
    }
    try {
        return JSON.stringify(toolResults).slice(0, 4000);
    } catch {
        return "";
    }
}

function wrapStateUpdate(
    parentName: string,
    slotKey: string,
    outcome: Record<string, unknown>,
): Record<string, unknown> {
    const toolResults = (outcome.toolResults as Record<string, unknown>) ?? {};
    const startedEvent = makeEventMessage("mini_agent.started", {
        parent: parentName,
        miniId: outcome.miniId ?? "",
        description: outcome.subTaskDescription ?? "",
    });
    const finishedPayload: Record<string, unknown> = {
        parent: parentName,
        miniId: outcome.miniId ?? "",
        status: outcome.status ?? "",
        durationMs: outcome.durationMs ?? 0,
    };
    if (outcome.error) {
        finishedPayload.error = outcome.error;
    }
    const finishedEvent = makeEventMessage("mini_agent.finished", finishedPayload);

    return {
        messages: [startedEvent, finishedEvent],
        miniAgentOutcomes: { [slotKey]: outcome },
        mcpContext: { [slotKey]: { toolResults } },
    };
}

function emitOutcome(opts: {
    parentName: string;
    miniId: string;
    description: string;
    status: "ok" | "failed" | "timeout";
    error?: string | null;
    durationMs?: number;
    slotKey?: string;
}): Record<string, unknown> {
    const outcome: Record<string, unknown> = {
        miniId: opts.miniId,
        subTaskDescription: opts.description,
        status: opts.status,
        summary: null,
        error: opts.error ?? null,
        durationMs: opts.durationMs ?? 0,
        toolResults: {},
    };
    return wrapStateUpdate(
        opts.parentName,
        opts.slotKey ?? `${opts.parentName}#${opts.miniId}`,
        outcome,
    );
}

function elapsedMs(start: number): number {
    return Math.round(performance.now() - start);
}

function isTimeoutError(exc: unknown): boolean {
    if (exc instanceof Error && (exc as any).code === "MINI_TIMEOUT") {
        return true;
    }
    if (exc instanceof DOMException && exc.name === "AbortError") {
        return true;
    }
    return false;
}

/**
 * Build a system message carrying a mini-agent lifecycle event.
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
