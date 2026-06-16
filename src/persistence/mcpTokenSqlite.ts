import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { OrchidMCPTokenStore, OrchidMCPTokenRecord } from "../core/mcpTokens.js";

function isMemoryDb(path: string): boolean {
    return path === ":memory:" || path.startsWith(":memory:?") || path.includes(":memory:");
}

export class OrchidSQLiteMCPTokenStore extends OrchidMCPTokenStore {
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
        this.ensureSchema();
    }

    async close(): Promise<void> {
        this.db?.close();
        this.db = null;
    }

    async getToken(
        tenantId: string,
        userId: string,
        serverName: string,
    ): Promise<OrchidMCPTokenRecord | null> {
        const row = this.db!.prepare(
            "SELECT * FROM mcp_oauth_tokens WHERE server_name = ? AND tenant_id = ? AND user_id = ?",
        ).get(serverName, tenantId, userId) as Record<string, unknown> | undefined;
        if (!row) return null;
        return new OrchidMCPTokenRecord({
            serverName: row.server_name as string,
            tenantId: row.tenant_id as string,
            userId: row.user_id as string,
            accessToken: row.access_token as string,
            refreshToken: row.refresh_token as string,
            expiresAt: row.expires_at as number,
            scopes: row.scopes as string,
        });
    }

    async saveToken(record: OrchidMCPTokenRecord): Promise<void> {
        const now = Date.now() / 1000;
        this.db!.prepare(
            "INSERT OR REPLACE INTO mcp_oauth_tokens " +
                "(server_name, tenant_id, user_id, access_token, refresh_token, expires_at, scopes, created_at, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
            record.serverName,
            record.tenantId,
            record.userId,
            record.accessToken,
            record.refreshToken,
            record.expiresAt,
            record.scopes,
            record.createdAt,
            now,
        );
    }

    async deleteToken(tenantId: string, userId: string, serverName: string): Promise<boolean> {
        const result = this.db!.prepare(
            "DELETE FROM mcp_oauth_tokens WHERE server_name = ? AND tenant_id = ? AND user_id = ?",
        ).run(serverName, tenantId, userId);
        return result.changes > 0;
    }

    async listTokens(tenantId: string, userId: string): Promise<OrchidMCPTokenRecord[]> {
        const rows = this.db!.prepare(
            "SELECT * FROM mcp_oauth_tokens WHERE tenant_id = ? AND user_id = ?",
        ).all(tenantId, userId) as Array<Record<string, unknown>>;
        return rows.map(
            (row) =>
                new OrchidMCPTokenRecord({
                    serverName: row.server_name as string,
                    tenantId: row.tenant_id as string,
                    userId: row.user_id as string,
                    accessToken: row.access_token as string,
                    refreshToken: row.refresh_token as string,
                    expiresAt: row.expires_at as number,
                    scopes: row.scopes as string,
                }),
        );
    }

    async cleanupExpired(before?: number): Promise<number> {
        const cutoff = before ?? Date.now() / 1000;
        const result = this.db!.prepare(
            "DELETE FROM mcp_oauth_tokens WHERE expires_at > 0 AND expires_at < ?",
        ).run(cutoff);
        return result.changes;
    }

    private ensureSchema(): void {
        this.db!.exec(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
        server_name TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
        access_token TEXT NOT NULL, refresh_token TEXT NOT NULL DEFAULT '',
        expires_at REAL NOT NULL DEFAULT 0, scopes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (server_name, tenant_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_oauth_tokens (tenant_id, user_id);
    `);
    }
}
