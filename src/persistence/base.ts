export interface ChatSession {
    id: string;
    tenantId: string;
    userId: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    isShared: boolean;
}

export interface Message {
    id: string;
    chatId: string;
    role: string;
    content: string;
    agentsUsed: string[];
    createdAt: Date;
    metadata: Record<string, unknown>;
}

export abstract class OrchidChatStorage {
    abstract initDb(): Promise<void>;
    abstract close(): Promise<void>;

    abstract createChat(tenantId: string, userId: string, title?: string): Promise<ChatSession>;
    abstract listChats(tenantId: string, userId: string): Promise<ChatSession[]>;
    abstract getChat(chatId: string): Promise<ChatSession | null>;
    abstract deleteChat(chatId: string): Promise<void>;
    abstract updateTitle(chatId: string, title: string): Promise<void>;
    abstract markShared(chatId: string): Promise<void>;

    abstract addMessage(
        chatId: string,
        role: string,
        content: string,
        agentsUsed?: string[],
        metadata?: Record<string, unknown>,
    ): Promise<Message>;

    abstract getMessages(chatId: string, limit?: number, offset?: number): Promise<Message[]>;

    async getChatMetadata(chatId: string): Promise<ChatSession | null> {
        return this.getChat(chatId);
    }

    async getConversationSummary(_chatId: string): Promise<string | null> {
        return null;
    }

    async saveConversationSummary(
        _chatId: string,
        _summary: string,
        _turnNumber: number,
    ): Promise<void> {
        // no-op default
    }
}
