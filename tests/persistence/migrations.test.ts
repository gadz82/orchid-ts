import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { getMigrations } from "../../src/persistence/migrations/v001InitialSchema.js";

let db: Database.Database;

beforeEach(() => {
    db = new Database(":memory:");
});

afterEach(() => {
    db.close();
});

describe("Migrations", () => {
    it("v001 creates all required tables", async () => {
        const migrations = getMigrations();
        expect(migrations).toHaveLength(1);

        const v001 = migrations[0];
        expect(v001.version).toBe("001");

        await v001.up(db, "sqlite");

        // Verify tables exist
        const tables = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_migrations' ORDER BY name",
            )
            .all() as Array<{ name: string }>;

        const names = tables.map((t) => t.name);
        expect(names).toContain("chat_sessions");
        expect(names).toContain("chat_messages");
        expect(names).toContain("mcp_oauth_tokens");
        expect(names).toContain("mcp_client_registrations");
        expect(names).toContain("mcp_gateway_clients");
        expect(names).toContain("mcp_gateway_auth_codes");
        expect(names).toContain("mcp_gateway_tokens");
        expect(names).toContain("conversation_summaries");
    });

    it("v001 down removes tables", async () => {
        const migrations = getMigrations();
        await migrations[0].up(db, "sqlite");
        await migrations[0].down(db, "sqlite");

        const tables = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_migrations'",
            )
            .all() as Array<{ name: string }>;
        expect(tables).toHaveLength(0);
    });

    it("v001 creates chat_messages with foreign key", async () => {
        const migrations = getMigrations();
        await migrations[0].up(db, "sqlite");

        db.prepare(
            "INSERT INTO chat_sessions (id, tenant_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run("sid-1", "t1", "u1", "Test", "2024-01-01", "2024-01-01");

        db.prepare(
            "INSERT INTO chat_messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run("mid-1", "sid-1", "user", "Hello", "2024-01-01");
    });
});
