/** Structured memory data types for OrchidConversationMemory. */

export interface OrchidSummaryEntity {
    name: string;
    type: string;
    relevance: number;
    details?: string;
}

export interface OrchidConversationSummary {
    chatId: string;
    agentName: string;
    summary: string;
    entities: OrchidSummaryEntity[];
    turnCount: number;
    updatedAt: number;
}

export const DEFAULT_NARRATIVE_FALLBACK_PROMPT = `
Summarize the conversation above in a single paragraph that captures
the key topics, facts, decisions, and open questions.  Be factual
and concise.
`;

export const DEFAULT_STRUCTURED_SUMMARY_SYSTEM_PROMPT = `
You are a conversation summarizer. Produce a JSON object with:
- "summary": a concise narrative paragraph
- "entities": an array of {name, type, relevance, details?}
- "turn_count": number of turns represented
`;

export const DEFAULT_STRUCTURED_SUMMARY_USER_PROMPT = `
Summarize the following conversation:
{history}
`;
