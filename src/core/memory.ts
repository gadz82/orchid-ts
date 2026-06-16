/** Conversation Memory ABC — persists and retrieves agent memory across sessions. */
import type { OrchidConversationSummary } from "./memoryTypes.js";

export abstract class OrchidConversationMemory {
    abstract load(chatId: string, agentName: string): Promise<OrchidConversationSummary | null>;

    abstract save(
        chatId: string,
        agentName: string,
        summary: OrchidConversationSummary,
    ): Promise<void>;

    abstract clear(chatId: string, agentName: string): Promise<void>;
}

export class NullConversationMemory extends OrchidConversationMemory {
    async load(_chatId: string, _agentName: string): Promise<OrchidConversationSummary | null> {
        return null;
    }

    async save(
        _chatId: string,
        _agentName: string,
        _summary: OrchidConversationSummary,
    ): Promise<void> {}

    async clear(_chatId: string, _agentName: string): Promise<void> {}
}
