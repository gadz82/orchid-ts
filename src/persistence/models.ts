import { z } from "zod";

export const ChatSessionSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    userId: z.string(),
    title: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    isShared: z.boolean().default(false),
});

export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const MessageSchema = z.object({
    id: z.string(),
    chatId: z.string(),
    role: z.string(),
    content: z.string(),
    agentsUsed: z.array(z.string()).default([]),
    createdAt: z.date(),
    metadata: z.record(z.string(), z.unknown()).default({}),
});

export type Message = z.infer<typeof MessageSchema>;

export function sessionToOut(session: ChatSession): Record<string, unknown> {
    return {
        id: session.id,
        tenantId: session.tenantId,
        userId: session.userId,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        isShared: session.isShared,
    };
}

export function messageToOut(message: Message): Record<string, unknown> {
    return {
        id: message.id,
        chatId: message.chatId,
        role: message.role,
        content: message.content,
        agentsUsed: message.agentsUsed,
        createdAt: message.createdAt.toISOString(),
        metadata: message.metadata,
    };
}
