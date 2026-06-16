import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { OrchidChatStorage, ChatSession, Message } from "./base.js";

function isMemoryDb(path: string): boolean {
    return path === ":memory:" || path.startsWith(":memory:?") || path.includes(":memory:");
}

function utcnow(): Date {
    return new Date();
}

function utcnowIso(): string {
    return utcnow().toISOString();
}

function parseDt(val: string | Date): Date {
    if (val instanceof Date) return val;
    try {
        return new Date(val);
    } catch {
        return utcnow();
    }
}

function jsonParse(val: unknown): unknown {
    if (typeof val === "string") {
        try {
            return JSON.parse(val);
        } catch {
            return val;
        }
    }
    return val;
}

export class OrchidSQLiteChatStorage extends OrchidChatStorage {
    private dbPath: string;
    private db: Database.Database | null = null;

    constructor(dsn: string) {
        super();
        this.dbPath = dsn.startsWith("~") ? dsn.replace("~", homedir()) : dsn;
    }

    async initDb(): Promise<void> {
        if (!isMemoryDb(this.dbPath)) {
            mkdirSync(dirname(this.dbPath) || ".", { recursive: true });
        }

        this.db = new Database(this.dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");

        this.runMigrations();
    }

    async close(): Promise<void> {
        this.db?.close();
        this.db = null;
    }

    async createChat(tenantId: string, userId: string, title = "New chat"): Promise<ChatSession> {
        const nowIso = utcnowIso();
        const id = randomUUID();
        this.db!.prepare(
            "INSERT INTO chat_sessions (id, tenant_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, tenantId, userId, title, nowIso, nowIso);
        return {
            id,
            tenantId,
            userId,
            title,
            createdAt: new Date(nowIso),
            updatedAt: new Date(nowIso),
            isShared: false,
        };
    }

    async listChats(tenantId: string, userId: string): Promise<ChatSession[]> {
        const rows = this.db!.prepare(
            "SELECT * FROM chat_sessions WHERE tenant_id = ? AND user_id = ? ORDER BY updated_at DESC",
        ).all(tenantId, userId) as Array<Record<string, unknown>>;
        return rows.map(rowToSession);
    }

    async getChat(chatId: string): Promise<ChatSession | null> {
        const row = this.db!.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(chatId) as
            | Record<string, unknown>
            | undefined;
        return row ? rowToSession(row) : null;
    }

    async deleteChat(chatId: string): Promise<void> {
        this.db!.prepare("DELETE FROM chat_sessions WHERE id = ?").run(chatId);
    }

    async updateTitle(chatId: string, title: string): Promise<void> {
        const nowIso = utcnowIso();
        this.db!.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?").run(
            title,
            nowIso,
            chatId,
        );
    }

    async markShared(chatId: string): Promise<void> {
        const nowIso = utcnowIso();
        this.db!.prepare("UPDATE chat_sessions SET is_shared = 1, updated_at = ? WHERE id = ?").run(
            nowIso,
            chatId,
        );
    }

    async addMessage(
        chatId: string,
        role: string,
        content: string,
        agentsUsed: string[] = [],
        metadata: Record<string, unknown> = {},
    ): Promise<Message> {
        const nowIso = utcnowIso();
        const id = randomUUID();
        this.db!.prepare(
            "INSERT INTO chat_messages (id, chat_id, role, content, agents_used, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
            id,
            chatId,
            role,
            content,
            JSON.stringify(agentsUsed),
            nowIso,
            JSON.stringify(metadata),
        );
        this.db!.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(
            nowIso,
            chatId,
        );
        return { id, chatId, role, content, agentsUsed, createdAt: new Date(nowIso), metadata };
    }

    async getMessages(chatId: string, limit = 50, offset = 0): Promise<Message[]> {
        const rows = this.db!.prepare(
            "SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?",
        ).all(chatId, limit, offset) as Array<Record<string, unknown>>;
        return rows.map(rowToMessage);
    }

    async getConversationSummary(chatId: string): Promise<string | null> {
        const row = this.db!.prepare(
            "SELECT summary_text FROM conversation_summaries WHERE chat_id = ?",
        ).get(chatId) as Record<string, unknown> | undefined;
        return row ? (row.summary_text as string) : null;
    }

    async saveConversationSummary(
        chatId: string,
        summary: string,
        turnNumber: number,
    ): Promise<void> {
        const nowIso = utcnowIso();
        this.db!.prepare(
            "INSERT INTO conversation_summaries (chat_id, summary_text, turn_number, updated_at) " +
                "VALUES (?, ?, ?, ?) " +
                "ON CONFLICT(chat_id) DO UPDATE SET summary_text = ?, turn_number = ?, updated_at = ?",
        ).run(chatId, summary, turnNumber, nowIso, summary, turnNumber, nowIso);
    }

    private runMigrations(): void {
        const db = this.db!;
        db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

        const applied = new Set(
            db
                .prepare("SELECT version FROM _migrations")
                .all()
                .map((r: unknown) => (r as Record<string, unknown>).version as string),
        );

        if (!applied.has("001")) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_shared INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user
          ON chat_sessions (tenant_id, user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          agents_used TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_messages_chat
          ON chat_messages (chat_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS conversation_summaries (
          chat_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
          summary_text TEXT NOT NULL,
          turn_number INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
            db.prepare("INSERT INTO _migrations (version, description) VALUES (?, ?)").run(
                "001",
                "Initial schema (chat persistence)",
            );
        }
    }
}

function rowToSession(row: Record<string, unknown>): ChatSession {
    return {
        id: row.id as string,
        tenantId: row.tenant_id as string,
        userId: row.user_id as string,
        title: row.title as string,
        createdAt: parseDt(row.created_at as string),
        updatedAt: parseDt(row.updated_at as string),
        isShared: !!(row.is_shared as number),
    };
}

function rowToMessage(row: Record<string, unknown>): Message {
    return {
        id: row.id as string,
        chatId: row.chat_id as string,
        role: row.role as string,
        content: row.content as string,
        agentsUsed: jsonParse(row.agents_used) as string[],
        createdAt: parseDt(row.created_at as string),
        metadata: jsonParse(row.metadata) as Record<string, unknown>,
    };
}
