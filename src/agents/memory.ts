/**
 * Conversation memory implementations.
 *
 * Provides concrete memory strategies that implement the
 * ``OrchidConversationMemory`` ABC from ``core/memory.js``.
 */
import type { ChatModelLike, OrchidConversationSummary } from "../core/index.js";
import { OrchidConversationMemory } from "../core/memory.js";

// ── Structured summary type matching Python OrchidConversationSummary ────

interface StructuredEntity {
    name: string;
    type: string;
    details?: string;
}

interface StructuredSummary {
    topics: string[];
    entities: StructuredEntity[];
    actions_taken: string[];
    decisions: string[];
    open_questions: string[];
    user_preferences: string[];
    narrative: string;
    covered_turns: number;
}

const DEFAULT_STRUCTURED_EXTENSION_SYSTEM_PROMPT = `
You are a conversation summarizer that produces structured summaries.
You have an existing summary and new messages to incorporate.
Update the summary to reflect new information, remove contradicted facts,
and merge duplicate entities.

Output ONLY valid JSON with the following schema:
{
  "topics": ["topic1"],
  "entities": [{"name": "entity_name", "type": "person|product|concept|other", "details": "key info"}],
  "actions_taken": ["action1"],
  "decisions": ["decision1"],
  "open_questions": ["question1"],
  "user_preferences": ["preference1"],
  "narrative": "A brief prose summary",
  "covered_turns": 5
}`;

const DEFAULT_STRUCTURED_EXTENSION_USER_PROMPT = `
Given the existing summary below and the new conversation messages,
produce an updated summary that incorporates all new information.

Existing summary: {existing_summary}

New messages: {new_messages}`;

const DEFAULT_STRUCTURED_SUMMARY_SYSTEM_PROMPT = `
You are a conversation summarizer that produces structured summaries.
Output ONLY valid JSON with the following schema:
{
  "topics": ["topic1"],
  "entities": [{"name": "entity_name", "type": "person|product|concept|other", "details": "key info"}],
  "actions_taken": ["action1"],
  "decisions": ["decision1"],
  "open_questions": ["question1"],
  "user_preferences": ["preference1"],
  "narrative": "A brief prose summary",
  "covered_turns": 5
}

Be factual and concise. Extract all entities, topics, and decisions mentioned.`;

const DEFAULT_STRUCTURED_SUMMARY_USER_PROMPT = `
Summarise the following conversation excerpt in structured JSON format.
Focus on: (1) the key topics discussed, (2) any entities or
names mentioned, (3) actions taken or decisions made, (4) any
outstanding questions. Be factual and concise.

{transcript}`;

// ── Structured summary helpers ───────────────────────────────────

function deduplicateList(existing: string[], incoming: string[]): string[] {
    const seen = new Set(existing);
    const result = [...existing];
    for (const item of incoming) {
        if (!seen.has(item)) {
            result.push(item);
            seen.add(item);
        }
    }
    return result;
}

function mergeEntities(
    existing: StructuredEntity[],
    incoming: Array<{ name?: string; type?: string; details?: string }>,
): StructuredEntity[] {
    const seen = new Map<string, StructuredEntity>();
    const result: StructuredEntity[] = [];
    for (const e of existing) {
        const copy: StructuredEntity = { name: e.name, type: e.type };
        if (e.details) copy.details = e.details;
        seen.set(copy.name.toLowerCase(), copy);
        result.push(copy);
    }
    for (const eDict of incoming) {
        const nameLower = (eDict.name ?? "").toLowerCase();
        if (seen.has(nameLower)) {
            const existingEntity = seen.get(nameLower)!;
            existingEntity.type = eDict.type ?? existingEntity.type;
            const newDetails = eDict.details ?? "";
            if (newDetails && !(existingEntity.details ?? "").includes(newDetails)) {
                existingEntity.details = (existingEntity.details ?? "") + "; " + newDetails;
            }
        } else {
            const entity: StructuredEntity = {
                name: eDict.name ?? "",
                type: eDict.type ?? "other",
            };
            if (eDict.details) entity.details = eDict.details;
            result.push(entity);
            seen.set(nameLower, entity);
        }
    }
    return result;
}

function mergeStructuredSummary(
    existing: StructuredSummary,
    newData: Partial<StructuredSummary>,
): StructuredSummary {
    return {
        topics: deduplicateList(existing.topics, newData.topics ?? []),
        entities: mergeEntities(
            existing.entities,
            (newData.entities ?? []) as Array<{
                name?: string;
                type?: string;
                details?: string;
            }>,
        ),
        actions_taken: deduplicateList(existing.actions_taken, newData.actions_taken ?? []),
        decisions: deduplicateList(existing.decisions, newData.decisions ?? []),
        open_questions: deduplicateList(existing.open_questions, newData.open_questions ?? []),
        user_preferences: deduplicateList(
            existing.user_preferences,
            newData.user_preferences ?? [],
        ),
        narrative: newData.narrative ?? existing.narrative,
        covered_turns: existing.covered_turns + (newData.covered_turns ?? 1),
    };
}

function structuredSummaryToDict(summary: StructuredSummary): Record<string, unknown> {
    return {
        topics: [...summary.topics],
        entities: summary.entities.map((e) => ({
            name: e.name,
            type: e.type,
            details: e.details ?? "",
        })),
        actions_taken: [...summary.actions_taken],
        decisions: [...summary.decisions],
        open_questions: [...summary.open_questions],
        user_preferences: [...summary.user_preferences],
        narrative: summary.narrative,
        covered_turns: summary.covered_turns,
    };
}

function structuredSummaryFromDict(data: Record<string, unknown>): StructuredSummary {
    const entities = ((data["entities"] as unknown[]) ?? []).map((e: unknown) => {
        const ent = e as Record<string, unknown>;
        return {
            name: String(ent["name"] ?? ""),
            type: String(ent["type"] ?? "other"),
            details: ent["details"] ? String(ent["details"]) : undefined,
        };
    });
    return {
        topics: (data["topics"] as string[]) ?? [],
        entities,
        actions_taken: (data["actions_taken"] as string[]) ?? [],
        decisions: (data["decisions"] as string[]) ?? [],
        open_questions: (data["open_questions"] as string[]) ?? [],
        user_preferences: (data["user_preferences"] as string[]) ?? [],
        narrative: String(data["narrative"] ?? ""),
        covered_turns: Number(data["covered_turns"] ?? 0),
    };
}

function fromJson(jsonStr: string): StructuredSummary | null {
    try {
        const data = JSON.parse(jsonStr);
        if (typeof data !== "object" || data === null) return null;
        return structuredSummaryFromDict(data);
    } catch {
        return null;
    }
}

function fromStringOrJson(text: string): StructuredSummary {
    const structured = fromJson(text);
    if (structured !== null) return structured;
    return {
        topics: [],
        entities: [],
        actions_taken: [],
        decisions: [],
        open_questions: [],
        user_preferences: [],
        narrative: text.trim(),
        covered_turns: 0,
    };
}

function structuredToTSSummary(
    ss: StructuredSummary,
    chatId: string,
    agentName: string,
): OrchidConversationSummary {
    return {
        chatId,
        agentName,
        summary: JSON.stringify(structuredSummaryToDict(ss)),
        entities: ss.entities.map((e) => ({
            name: e.name,
            type: e.type,
            relevance: 1,
            details: e.details,
        })),
        turnCount: ss.covered_turns,
        updatedAt: Date.now(),
    };
}

// ── Concrete implementation ──────────────────────────────────────

export class OrchidInMemoryConversationMemory extends OrchidConversationMemory {
    private storage: {
        getConversationSummary(chatId: string): Promise<string | null>;
        saveConversationSummary(chatId: string, summary: string, turnNumber: number): Promise<void>;
    };
    private chatModel: ChatModelLike;
    private structuredOutput: boolean;

    constructor(
        chatStorage: {
            getConversationSummary(chatId: string): Promise<string | null>;
            saveConversationSummary(
                chatId: string,
                summary: string,
                turnNumber: number,
            ): Promise<void>;
        },
        chatModel: ChatModelLike,
        opts: { structuredOutput?: boolean } = {},
    ) {
        super();
        this.storage = chatStorage;
        this.chatModel = chatModel;
        this.structuredOutput = opts.structuredOutput ?? true;
    }

    // ── OrchidConversationMemory ABC ────────────────────────────────

    async load(chatId: string, agentName: string): Promise<OrchidConversationSummary | null> {
        const raw = await this.storage.getConversationSummary(chatId);
        if (!raw) return null;
        const ss = fromStringOrJson(raw);
        return structuredToTSSummary(ss, chatId, agentName);
    }

    async save(
        chatId: string,
        _agentName: string,
        summary: OrchidConversationSummary,
    ): Promise<void> {
        const jsonStr = summary.summary;
        const turnCount = summary.turnCount ?? 0;
        await this.storage.saveConversationSummary(chatId, jsonStr, turnCount);
    }

    async clear(chatId: string, _agentName: string): Promise<void> {
        await this.storage.saveConversationSummary(chatId, "", 0);
    }

    // ── Running summary (Python-compatible) ─────────────────────────

    async getRunningSummary(chatId: string): Promise<string | null> {
        return this.storage.getConversationSummary(chatId);
    }

    async updateRunningSummary(
        chatId: string,
        newMessages: Array<Record<string, string>>,
        existingSummary: string | null,
    ): Promise<string> {
        if (newMessages.length === 0) {
            return existingSummary ?? "";
        }

        const transcript = newMessages
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join("\n");
        const turnNumber = newMessages.length;

        if (this.structuredOutput) {
            return this.updateStructured(chatId, transcript, existingSummary, turnNumber);
        } else {
            return this.updateNarrative(chatId, transcript, existingSummary, turnNumber);
        }
    }

    async getRelevantHistory(
        _query: string,
        _chatId: string,
        _k = 5,
    ): Promise<Array<Record<string, unknown>>> {
        return [];
    }

    async storeConversationTurn(
        _chatId: string,
        _tenantId: string,
        _userId: string,
        _turn: Record<string, string>,
        _metadata?: Record<string, unknown> | null,
    ): Promise<void> {
        // no-op: running-summary-only memory
    }

    // ── Private helpers ─────────────────────────────────────────────

    private async updateNarrative(
        chatId: string,
        transcript: string,
        existingSummary: string | null,
        turnNumber: number,
    ): Promise<string> {
        let prompt: string;
        if (existingSummary) {
            prompt =
                "Given this existing summary and these new conversation messages, " +
                "produce an updated summary that incorporates all new information.\n\n" +
                `Existing summary:\n${existingSummary}\n\n` +
                `New messages:\n${transcript}`;
        } else {
            prompt =
                "Summarise the following conversation in one short paragraph. " +
                "Focus on: key topics discussed, entities mentioned, actions taken, " +
                "and any outstanding questions or requests.\n\n" +
                transcript;
        }

        let updatedSummary: string;
        try {
            const result = await this.chatModel.invoke([{ role: "user", content: prompt }], {
                temperature: 0.0,
            });
            updatedSummary = result.content ?? "";
        } catch (exc: unknown) {
            console.warn("Conversation memory update failed (%s), keeping existing summary", exc);
            return existingSummary ?? "";
        }

        await this.storage.saveConversationSummary(chatId, updatedSummary, turnNumber);
        return updatedSummary;
    }

    private async updateStructured(
        chatId: string,
        transcript: string,
        existingSummary: string | null,
        turnNumber: number,
    ): Promise<string> {
        let systemPrompt: string;
        let userPrompt: string;

        if (existingSummary) {
            const existingParsed = fromStringOrJson(existingSummary);
            systemPrompt = DEFAULT_STRUCTURED_EXTENSION_SYSTEM_PROMPT;
            userPrompt = DEFAULT_STRUCTURED_EXTENSION_USER_PROMPT.replace(
                "{existing_summary}",
                JSON.stringify(structuredSummaryToDict(existingParsed), null, 2),
            ).replace("{new_messages}", transcript);
        } else {
            systemPrompt = DEFAULT_STRUCTURED_SUMMARY_SYSTEM_PROMPT;
            userPrompt = DEFAULT_STRUCTURED_SUMMARY_USER_PROMPT.replace("{transcript}", transcript);
        }

        let responseText: string;
        try {
            const result = await this.chatModel.invoke(
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                { temperature: 0.0 },
            );
            responseText = result.content ?? "";
        } catch (exc: unknown) {
            console.warn("Conversation memory update failed (%s), keeping existing summary", exc);
            return existingSummary ?? "";
        }

        const parsed = fromJson(responseText);
        let updatedSummary: string;
        if (parsed !== null) {
            if (existingSummary) {
                const existingParsed = fromStringOrJson(existingSummary);
                const merged = mergeStructuredSummary(existingParsed, parsed);
                updatedSummary = JSON.stringify(structuredSummaryToDict(merged));
            } else {
                updatedSummary = JSON.stringify(structuredSummaryToDict(parsed));
            }
        } else {
            console.warn("Structured summary JSON parse failed, storing raw response");
            updatedSummary = responseText;
        }

        await this.storage.saveConversationSummary(chatId, updatedSummary, turnNumber);
        return updatedSummary;
    }
}
