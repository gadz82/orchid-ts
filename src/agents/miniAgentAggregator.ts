/**
 * Mini-agent aggregator node.
 *
 * Port of orchid/orchid_ai/agents/mini_agent_aggregator.py
 *
 * Runs once per parent agent per turn after every mini in that turn
 * has produced a final outcome.  LangGraph's join semantics ensure all
 * parallel Sends have completed before this node fires.
 */

import type { ChatModelLike } from "../core/index.js";
import type { OrchidAgentConfig } from "../config/schema/index.js";
import type { MiniAgentOutcome } from "./miniAgentNode.js";

// ── Default aggregator prompt ────────────────────────────────────

export const DEFAULT_AGGREGATOR_PROMPT = `\
You are synthesising the final answer for the "{agent_name}" agent.
The original user request was: {user_query}

You ran {n} independent sub-tasks in parallel. Their outcomes:
{outcome_block}

Produce ONE coherent answer for the user. Rules:
  - If failures or timeouts are blocking, say so explicitly. Tell the user
    which sub-tasks succeeded and which didn't.
  - Do NOT invent results for failed/timed-out sub-tasks.
  - Cite the sub-task description when referencing its findings.
  - Do not mention "mini-agents" or internal architecture — speak as the agent.`;

// ── Factory ──────────────────────────────────────────────────────

export function aggregatorNodeFactory(opts: {
    parentConfig: OrchidAgentConfig;
    chatModel: ChatModelLike;
}): (state: Record<string, unknown>) => Promise<Record<string, unknown>> {
    const parentName = opts.parentConfig.name;
    const chatModel = opts.chatModel;
    const promptTemplate =
        opts.parentConfig.miniAgent.aggregatorPrompt || DEFAULT_AGGREGATOR_PROMPT;

    async function aggregatorNode(
        state: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const outcomes = collectOutcomes(state, parentName);

        if (outcomes.length === 0) {
            return shortCircuitMessage({
                parentName,
                outcomes,
                reason: "no mini-agent outcomes were recorded",
            });
        }

        // All-failed short-circuit
        const successful = outcomes.filter((o) => o.status === "ok");
        if (successful.length === 0) {
            const errorSummary = summariseFailures(outcomes);
            return shortCircuitMessage({
                parentName,
                outcomes,
                reason: errorSummary,
            });
        }

        // LLM-framed synthesis
        let userQuery = "";
        try {
            const { extractUserQuery } = await import("../core/helpers.js");
            userQuery = extractUserQuery(state as any) || "(no query found)";
        } catch {
            userQuery = "(no query found)";
        }

        const prompt = promptTemplate
            .replace(/\{agent_name\}/g, parentName)
            .replace(/\{user_query\}/g, userQuery)
            .replace(/\{n\}/g, String(outcomes.length))
            .replace(/\{outcome_block\}/g, renderOutcomeBlock(outcomes));

        let synthesis: string;
        try {
            const response = await chatModel.invoke([{ role: "system", content: prompt }]);
            synthesis =
                typeof response.content === "string"
                    ? response.content
                    : ((response.content as any)?.text ?? "");
        } catch (exc: unknown) {
            console.error(`[${parentName}/aggregator] synthesis LLM call failed: ${exc}`, exc);
            synthesis = fallbackSynthesis(outcomes);
        }

        const mergedToolResults = mergeSuccessfulToolResults(outcomes);
        const aggregatedEvent = makeEventMessage("mini_agent.aggregated", {
            parent: parentName,
            outcomes: outcomes.map((o) => ({
                miniId: o.miniId,
                status: o.status,
            })),
        });

        return {
            messages: [
                aggregatedEvent,
                {
                    type: "ai",
                    content: synthesis,
                    name: parentName,
                },
            ],
            mcpContext: {
                [parentName]: {
                    toolResults: mergedToolResults,
                    summary: synthesis,
                    miniOutcomes: outcomes,
                },
            },
            activeAgents: [],
        };
    }

    Object.defineProperty(aggregatorNode, "name", {
        value: `${parentName}_aggregator`,
        configurable: true,
    });

    return aggregatorNode;
}

// ── Helpers ──────────────────────────────────────────────────────

function collectOutcomes(state: Record<string, unknown>, parentName: string): MiniAgentOutcome[] {
    const raw = (state.miniAgentOutcomes as Record<string, unknown>) ?? {};
    const prefix = `${parentName}#`;
    const matches: Array<[string, Record<string, unknown>]> = [];
    for (const [key, value] of Object.entries(raw)) {
        if (key.startsWith(prefix) && typeof value === "object" && value !== null) {
            matches.push([key, value as Record<string, unknown>]);
        }
    }
    // Sort by miniId for stable ordering
    matches.sort((a, b) => (a[1].miniId as string)?.localeCompare(b[1].miniId as string) ?? 0);
    return matches.map(([_, v]) => ({
        miniId: (v.miniId as string) ?? "",
        subTaskDescription: (v.subTaskDescription as string) ?? "",
        status: (v.status as MiniAgentOutcome["status"]) ?? "failed",
        summary: (v.summary as string | null) ?? null,
        error: (v.error as string | null) ?? null,
        durationMs: (v.durationMs as number) ?? 0,
        toolResults: (v.toolResults as Record<string, string>) ?? {},
    }));
}

function renderOutcomeBlock(outcomes: MiniAgentOutcome[]): string {
    const lines: string[] = [];
    for (const outcome of outcomes) {
        const status = outcome.status ?? "?";
        const description = outcome.subTaskDescription || "(unknown)";
        let body: string;
        if (status === "ok") {
            body = (outcome.summary ?? "").trim() || "(no summary)";
        } else {
            body = (outcome.error ?? "").trim() || status;
        }
        lines.push(`  - [${status}] ${description}: ${body}`);
    }
    return lines.join("\n");
}

function mergeSuccessfulToolResults(outcomes: MiniAgentOutcome[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const outcome of outcomes) {
        if (outcome.status !== "ok") continue;
        for (const [k, v] of Object.entries(outcome.toolResults ?? {})) {
            merged[k] = v;
        }
    }
    return merged;
}

function shortCircuitMessage(opts: {
    parentName: string;
    outcomes: MiniAgentOutcome[];
    reason: string;
}): Record<string, unknown> {
    const { parentName, outcomes, reason } = opts;
    const text = `Sorry, I couldn't complete this request: ${reason}`;
    const aggregatedEvent = makeEventMessage("mini_agent.aggregated", {
        parent: parentName,
        outcomes: outcomes.map((o) => ({
            miniId: o.miniId,
            status: o.status,
        })),
    });

    return {
        messages: [
            aggregatedEvent,
            {
                type: "ai",
                content: text,
                name: parentName,
            },
        ],
        mcpContext: {
            [parentName]: {
                toolResults: {},
                summary: text,
                miniOutcomes: outcomes,
            },
        },
        activeAgents: [],
    };
}

function summariseFailures(outcomes: MiniAgentOutcome[]): string {
    if (outcomes.length === 0) {
        return "no sub-task results were produced";
    }

    const buckets: Record<string, string[]> = {
        failed: [],
        timeout: [],
    };

    for (const o of outcomes) {
        const status = o.status ?? "?";
        if (status in buckets) {
            const label = o.subTaskDescription || o.miniId || "?";
            buckets[status].push(label);
        }
    }

    const fragments: string[] = [];
    if (buckets.timeout.length > 0) {
        fragments.push("timed out: " + buckets.timeout.join(", "));
    }
    if (buckets.failed.length > 0) {
        fragments.push("failed: " + buckets.failed.join(", "));
    }
    return fragments.join("; ") || "all sub-tasks failed";
}

function fallbackSynthesis(outcomes: MiniAgentOutcome[]): string {
    const successful = outcomes.filter((o) => o.status === "ok");
    if (successful.length === 0) {
        return `Sorry, I couldn't complete this request: ${summariseFailures(outcomes)}`;
    }
    const parts = ["Here is what I found:"];
    for (const o of successful) {
        const desc = o.subTaskDescription || "";
        const summary = (o.summary ?? "").trim();
        if (summary) {
            parts.push(`- ${desc}: ${summary}`);
        } else {
            parts.push(`- ${desc}`);
        }
    }
    return parts.join("\n");
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
