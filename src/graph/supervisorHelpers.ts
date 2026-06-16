import type { ChatModelLike } from "../core/helpers.js";
import type { GraphState } from "./state.js";

const DEFAULT_SKIP_PREFIXES = ["[Supervisor"];

export function filterInternalMessages(
    messages: Array<Record<string, unknown>>,
    skipPrefixes: string[] = DEFAULT_SKIP_PREFIXES,
): Array<Record<string, unknown>> {
    const filtered: Array<Record<string, unknown>> = [];
    for (const msg of messages) {
        const msgType = typeof msg["type"] === "string" ? msg["type"] : "";
        if (msgType === "ai") {
            const content = String(msg["content"] ?? "");
            if (skipPrefixes.some((pfx) => content.startsWith(pfx))) {
                continue;
            }
        }
        filtered.push(msg);
    }
    return filtered;
}

export function extractSingleAgentResponse(state: GraphState): string | null {
    const messages = (state.messages ?? []) as Array<Record<string, unknown>>;
    if (messages.length === 0) return null;

    let lastUserIdx = -1;
    for (let i = 0; i < messages.length; i++) {
        const msgType = typeof messages[i]["type"] === "string" ? messages[i]["type"] : "";
        if (msgType === "human") {
            lastUserIdx = i;
        }
    }
    if (lastUserIdx < 0) return null;

    const currentTurn = messages.slice(lastUserIdx + 1);

    const agentOutputs: string[] = [];
    for (const msg of currentTurn) {
        const msgType = typeof msg["type"] === "string" ? msg["type"] : "";
        if (msgType !== "ai") continue;
        const content = String(msg["content"] ?? "");
        if (!content) continue;
        if (content.startsWith("[Supervisor")) continue;
        if (msg["tool_calls"] != null) continue;
        if (!(content.startsWith("[") && content.includes("Agent]\n"))) continue;
        const newlineIdx = content.indexOf("\n");
        if (newlineIdx < 0) continue;
        const body = content.slice(newlineIdx + 1).trim();
        if (body) {
            agentOutputs.push(body);
        }
    }

    if (agentOutputs.length !== 1) return null;
    return agentOutputs[0];
}

export function toLlmMessages(
    system: string,
    stateMessages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
    const llmMsgs: Array<Record<string, unknown>> = [{ role: "system", content: system }];
    for (const msg of stateMessages) {
        const msgType = typeof msg["type"] === "string" ? msg["type"] : "";
        if (msgType === "human") {
            llmMsgs.push({ role: "user", content: String(msg["content"] ?? "") });
        } else if (msgType === "ai") {
            llmMsgs.push({ role: "assistant", content: String(msg["content"] ?? "") });
        }
    }
    return llmMsgs;
}

export async function llmComplete(
    chatModel: ChatModelLike | null,
    _model: string,
    messages: Array<Record<string, unknown>>,
    opts: { temperature?: number; responseFormat?: Record<string, unknown> } = {},
): Promise<string> {
    if (!chatModel) {
        throw new Error(
            "Supervisor requires a chat model. Pass chatModel when building the graph.",
        );
    }
    const kwargs: Record<string, unknown> = { temperature: opts.temperature ?? 0.0 };
    if (opts.responseFormat) {
        kwargs["response_format"] = opts.responseFormat;
    }
    const result = await chatModel.ainvoke(messages, kwargs);
    return result.content ?? "";
}
