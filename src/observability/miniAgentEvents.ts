/**
 * Mini-agent lifecycle event helpers.
 *
 * When mini-agent decomposition is enabled on a top-level agent, four
 * lifecycle events are emitted through the message stream (via
 * LangChain-compatible message additional_kwargs):
 *
 *   mini_agent.decomposed   — the decomposer produced sub-tasks
 *   mini_agent.started      — a single mini-agent node began execution
 *   mini_agent.finished     — a single mini-agent node completed
 *   mini_agent.aggregated   — the aggregator stitched outcomes together
 *
 * These helpers create and detect those event-stub messages.
 */

export const MINI_AGENT_EVENT_KEY = "orchid_event";

export type MiniAgentEventName =
    | "mini_agent.decomposed"
    | "mini_agent.started"
    | "mini_agent.finished"
    | "mini_agent.aggregated";

/**
 * Build a system message that carries a mini-agent lifecycle event
 * in its `additional_kwargs`.  The message is compatible with
 * LangChain-like message lists — `type: 'system'`, `content: ''`,
 * and the event payload tucked under `additional_kwargs`.
 */
export function makeEventMessage(
    name: MiniAgentEventName,
    data: Record<string, unknown>,
): Record<string, unknown> {
    return {
        type: "system",
        content: "",
        additional_kwargs: { [MINI_AGENT_EVENT_KEY]: name, data },
    };
}

/**
 * Try to extract a mini-agent event from a message dict.
 * Returns `[eventName, data]` on success or `null` if the message
 * does not carry a recognised mini-agent event.
 */
export function extractEvent(
    msg: Record<string, unknown>,
): [string, Record<string, unknown>] | null {
    const ak = msg["additional_kwargs"] as Record<string, unknown> | undefined;
    if (!ak) return null;
    const key = ak[MINI_AGENT_EVENT_KEY];
    if (typeof key !== "string") return null;
    const data = (ak["data"] as Record<string, unknown>) ?? {};
    return [key, data];
}

/**
 * Returns `true` if the message carries a mini-agent lifecycle event.
 */
export function isEventMessage(msg: Record<string, unknown>): boolean {
    return extractEvent(msg) !== null;
}
