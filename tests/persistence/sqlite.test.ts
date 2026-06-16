import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OrchidSQLiteChatStorage } from "../../src/persistence/sqlite.js";

let storage: OrchidSQLiteChatStorage;

beforeEach(async () => {
    storage = new OrchidSQLiteChatStorage(":memory:");
    await storage.initDb();
});

afterEach(async () => {
    await storage.close();
});

describe("OrchidSQLiteChatStorage", () => {
    it("creates and retrieves a chat session", async () => {
        const chat = await storage.createChat("t1", "u1", "Test chat");
        expect(chat.id).toBeDefined();
        expect(chat.tenantId).toBe("t1");
        expect(chat.userId).toBe("u1");
        expect(chat.title).toBe("Test chat");
        expect(chat.createdAt).toBeInstanceOf(Date);
        expect(chat.isShared).toBe(false);

        const retrieved = await storage.getChat(chat.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(chat.id);
        expect(retrieved!.title).toBe("Test chat");
    });

    it("lists chats for a user", async () => {
        await storage.createChat("t1", "u1", "Chat 1");
        await storage.createChat("t1", "u1", "Chat 2");
        await storage.createChat("t1", "u2", "Other user");

        const u1Chats = await storage.listChats("t1", "u1");
        expect(u1Chats).toHaveLength(2);

        const u2Chats = await storage.listChats("t1", "u2");
        expect(u2Chats).toHaveLength(1);
    });

    it("returns null for missing chat", async () => {
        const result = await storage.getChat("nonexistent");
        expect(result).toBeNull();
    });

    it("deletes a chat", async () => {
        const chat = await storage.createChat("t1", "u1", "To delete");
        await storage.deleteChat(chat.id);

        const result = await storage.getChat(chat.id);
        expect(result).toBeNull();
    });

    it("updates chat title", async () => {
        const chat = await storage.createChat("t1", "u1", "Original");
        await storage.updateTitle(chat.id, "Updated");

        const result = await storage.getChat(chat.id);
        expect(result!.title).toBe("Updated");
    });

    it("marks chat as shared", async () => {
        const chat = await storage.createChat("t1", "u1", "Private");
        await storage.markShared(chat.id);

        const result = await storage.getChat(chat.id);
        expect(result!.isShared).toBe(true);
    });

    it("adds and retrieves messages", async () => {
        const chat = await storage.createChat("t1", "u1", "Chat");
        const msg = await storage.addMessage(chat.id, "user", "Hello", ["agent1"], { key: "val" });

        expect(msg.id).toBeDefined();
        expect(msg.chatId).toBe(chat.id);
        expect(msg.role).toBe("user");
        expect(msg.content).toBe("Hello");
        expect(msg.agentsUsed).toEqual(["agent1"]);
        expect(msg.metadata).toEqual({ key: "val" });

        const msgs = await storage.getMessages(chat.id);
        expect(msgs).toHaveLength(1);
        expect(msgs[0].content).toBe("Hello");
    });

    it("paginates messages with limit and offset", async () => {
        const chat = await storage.createChat("t1", "u1", "Chat");
        await storage.addMessage(chat.id, "user", "Msg1");
        await storage.addMessage(chat.id, "assistant", "Msg2");
        await storage.addMessage(chat.id, "user", "Msg3");

        const limited = await storage.getMessages(chat.id, 2, 0);
        expect(limited).toHaveLength(2);
        expect(limited[0].content).toBe("Msg1");

        const offset = await storage.getMessages(chat.id, 2, 2);
        expect(offset).toHaveLength(1);
        expect(offset[0].content).toBe("Msg3");
    });

    it("saves and retrieves conversation summary", async () => {
        const chat = await storage.createChat("t1", "u1", "Chat");
        await storage.saveConversationSummary(chat.id, "The summary", 3);

        const summary = await storage.getConversationSummary(chat.id);
        expect(summary).toBe("The summary");
    });

    it("returns null for missing conversation summary", async () => {
        const summary = await storage.getConversationSummary("nonexistent");
        expect(summary).toBeNull();
    });

    it("chat metadata is an alias for getChat", async () => {
        const chat = await storage.createChat("t1", "u1", "Test");
        const meta = await storage.getChatMetadata(chat.id);
        expect(meta).not.toBeNull();
        expect(meta!.id).toBe(chat.id);
    });
});
