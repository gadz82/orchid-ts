/**
 * Standalone helpers for agent operations.
 *
 * These functions contain reusable logic that OrchidAgent methods delegate to.
 * They can also be imported directly by custom agents or tests.
 */
import type { OrchidRAGScope } from "./scopes.js";
import type { OrchidAgentState } from "./state.js";
import type { OrchidVectorReader, OrchidSearchResult } from "./repository.js";
import { OrchidTruncationStrategy, truncateContent } from "./truncation.js";

export interface ConversationMessage {
    role: "human" | "ai" | "tool";
    content: string;
    name?: string;
}

/** Duck-type for LLM invocation — avoids langchain dependency in core/. */
export interface ChatModelLike {
    ainvoke(messages: unknown[], options?: Record<string, unknown>): Promise<{ content: string }>;
}

const SUMMARISE_SYSTEM_TEMPLATE = `You are a helpful assistant that provides concise, accurate summaries.
{system_prompt}

Current conversation summary (from earlier turns):
{conversation_history}

Previous tool results (from earlier in this conversation):
{prior_tool_context}
`;

const SUMMARISE_USER_TEMPLATE = `Answer the following question concisely and accurately.
If you are summarising, base your summary only on the data provided.

{query}

MCP Data:
{mcp_data}

RAG Data:
{rag_data}

Focus instruction: Prioritise the latest query and the most recent information.`;

const SUMMARISE_FOCUS_INSTRUCTION =
    "Pay special attention to the latest query and the most recent conversation turn.";

const HISTORY_COMPRESSION_SYSTEM = `Summarise the following conversation history concisely.
Preserve key facts, decisions, and context. Output only the summary paragraph.`;

export interface ExtractHistoryOptions {
    maxTurns?: number;
    maxChars?: number;
    skipPrefixes?: readonly string[];
    stripPrefixes?: readonly string[];
    truncationStrategy?: string;
}

export function extractUserQuery(state: OrchidAgentState): string {
    const messages = state.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as Record<string, unknown>;
        if (msg["type"] === "human") {
            return String(msg["content"] ?? "");
        }
    }
    return "";
}

export function extractConversationHistory(
    state: OrchidAgentState,
    options: ExtractHistoryOptions = {},
): ConversationMessage[] {
    const {
        maxTurns = 10,
        maxChars,
        skipPrefixes = ["[Supervisor"],
        stripPrefixes,
        truncationStrategy = "hard",
    } = options;

    const messages = state.messages ?? [];
    if (messages.length === 0) return [];

    const result: ConversationMessage[] = [];
    let pairs = 0;
    let foundLastUser = false;

    // Walk from the end, skip the last human message (current query)
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as Record<string, unknown>;
        const msgType = String(msg["type"] ?? "");

        // Skip the last user message (current query)
        if (!foundLastUser && msgType === "human") {
            foundLastUser = true;
            continue;
        }

        // Skip tool messages
        if (msgType === "tool") continue;

        if (msgType === "ai") {
            let content = String(msg["content"] ?? "");
            // Skip supervisor routing messages
            if (skipPrefixes.some((pfx) => content.startsWith(pfx))) continue;
            // Strip agent name prefixes
            if (stripPrefixes) {
                for (const pfx of stripPrefixes) {
                    if (content.startsWith(pfx)) {
                        content = content.slice(pfx.length).trim();
                        break;
                    }
                }
            }
            if (maxChars && content.length > maxChars) {
                content = truncateContent(
                    content,
                    maxChars,
                    truncationStrategy as OrchidTruncationStrategy,
                );
            }
            const name = String(msg["name"] ?? "");
            result.unshift({ role: "ai", content, name: name || undefined });
        } else if (msgType === "human") {
            let content = String(msg["content"] ?? "");
            if (maxChars && content.length > maxChars) {
                content = truncateContent(
                    content,
                    maxChars,
                    truncationStrategy as OrchidTruncationStrategy,
                );
            }
            result.unshift({ role: "human", content });
            pairs++;
        }

        if (pairs >= maxTurns) break;
    }

    return result;
}

export async function compressConversationHistory(
    history: ConversationMessage[],
    chatModel: ChatModelLike,
    {
        recentTurns = 10,
        runningSummary,
        structuredOutput = false,
    }: {
        recentTurns?: number;
        runningSummary?: string;
        structuredOutput?: boolean;
    } = {},
): Promise<ConversationMessage[]> {
    const recentCount = recentTurns * 2;
    if (history.length <= recentCount) return history;

    const older = history.slice(0, history.length - recentCount);
    const recent = history.slice(-recentCount);

    if (older.length === 0) return recent;

    const olderText = older.map((m) => `${m.role}: ${m.content}`).join("\n");
    let prompt: string;
    if (runningSummary) {
        prompt = `Previous summary:\n${runningSummary}\n\nNew messages to add:\n${olderText}\n\nUpdate the summary to include the new messages.`;
    } else {
        prompt = olderText;
    }

    try {
        const systemPrompt = structuredOutput
            ? `${HISTORY_COMPRESSION_SYSTEM}\nOutput JSON with keys: summary, entities.`
            : HISTORY_COMPRESSION_SYSTEM;
        const result = await chatModel.ainvoke(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt },
            ],
            { temperature: 0.0 },
        );
        const summary = result.content || olderText.slice(0, 500);
        return [{ role: "ai", content: `[Conversation summary]\n${summary}` }, ...recent];
    } catch {
        return recent;
    }
}

export async function summarise(
    query: string,
    mcpData: Record<string, unknown> | null,
    ragData: Record<string, unknown> | null,
    chatModel: ChatModelLike,
    {
        systemPrompt = "",
        conversationHistory,
        priorToolContext,
    }: {
        systemPrompt?: string;
        conversationHistory?: ConversationMessage[];
        priorToolContext?: Record<string, unknown> | null;
    } = {},
): Promise<string> {
    const messages: Record<string, unknown>[] = [];

    const systemText = SUMMARISE_SYSTEM_TEMPLATE.replace("{system_prompt}", systemPrompt)
        .replace(
            "{conversation_history}",
            conversationHistory ? formatHistory(conversationHistory) : "",
        )
        .replace(
            "{prior_tool_context}",
            priorToolContext ? formatToolContext(priorToolContext) : "",
        );

    messages.push({ role: "system", content: systemText });

    const userText = SUMMARISE_USER_TEMPLATE.replace("{query}", query)
        .replace("{mcp_data}", formatData(mcpData))
        .replace("{rag_data}", formatData(ragData));

    if (conversationHistory && conversationHistory.length > 0) {
        messages.push({ role: "user", content: `${userText}\n\n${SUMMARISE_FOCUS_INSTRUCTION}` });
    } else {
        messages.push({ role: "user", content: userText });
    }

    const result = await chatModel.ainvoke(messages, { temperature: 0.3 });
    return result.content;
}

export async function fetchRagContext(
    query: string,
    scope: OrchidRAGScope,
    reader: OrchidVectorReader,
    namespace: string,
    k = 5,
): Promise<OrchidSearchResult[]> {
    return reader.retrieve(query, namespace, k, scope);
}

// Internal formatters
function formatHistory(history: ConversationMessage[]): string {
    return history.map((m) => `${m.role}: ${m.content}`).join("\n");
}

function formatToolContext(ctx: Record<string, unknown>): string {
    const text = JSON.stringify(ctx, null, 2);
    return text.length > 4000 ? text.slice(0, 4000) + "\n...(truncated)" : text;
}

function formatData(data: Record<string, unknown> | null): string {
    if (!data || Object.keys(data).length === 0) return "(none)";
    return JSON.stringify(data, null, 2);
}

/** ChatModelLike factory — validates duck-type at runtime. */
export function isChatModelLike(obj: unknown): obj is ChatModelLike {
    return typeof obj === "object" && obj !== null && typeof (obj as any)["ainvoke"] === "function";
}
