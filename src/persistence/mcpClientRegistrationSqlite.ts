import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
    OrchidMCPClientRegistrationStore,
    OrchidMCPClientRegistration,
} from "../core/mcpRegistration.js";

function isMemoryDb(path: string): boolean {
    return path === ":memory:" || path.startsWith(":memory:?") || path.includes(":memory:");
}

export class OrchidSQLiteMCPClientRegistrationStore extends OrchidMCPClientRegistrationStore {
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

    async get(serverName: string): Promise<OrchidMCPClientRegistration | null> {
        const row = this.db!.prepare(
            "SELECT * FROM mcp_client_registrations WHERE server_name = ?",
        ).get(serverName) as Record<string, unknown> | undefined;
        if (!row) return null;
        return new OrchidMCPClientRegistration({
            serverName: row.server_name as string,
            authorizationEndpoint: row.authorization_endpoint as string,
            tokenEndpoint: row.token_endpoint as string,
            registrationEndpoint: row.registration_endpoint as string,
            issuer: row.issuer as string,
            scopesSupported: row.scopes_supported as string,
            tokenEndpointAuthMethodsSupported: row.token_endpoint_auth_methods_supported as string,
            clientId: row.client_id as string,
            clientSecret: row.client_secret as string,
            clientIdIssuedAt: row.client_id_issued_at as number,
            clientSecretExpiresAt: row.client_secret_expires_at as number,
        });
    }

    async save(record: OrchidMCPClientRegistration): Promise<void> {
        const now = Date.now() / 1000;
        this.db!.prepare(
            "INSERT OR REPLACE INTO mcp_client_registrations " +
                "(server_name, authorization_endpoint, token_endpoint, registration_endpoint, " +
                " issuer, scopes_supported, token_endpoint_auth_methods_supported, " +
                " client_id, client_secret, client_id_issued_at, client_secret_expires_at, " +
                " created_at, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
            record.serverName,
            record.authorizationEndpoint,
            record.tokenEndpoint,
            record.registrationEndpoint,
            record.issuer,
            record.scopesSupported,
            record.tokenEndpointAuthMethodsSupported,
            record.clientId,
            record.clientSecret,
            record.clientIdIssuedAt,
            record.clientSecretExpiresAt,
            record.createdAt,
            now,
        );
    }

    async delete(serverName: string): Promise<boolean> {
        const result = this.db!.prepare(
            "DELETE FROM mcp_client_registrations WHERE server_name = ?",
        ).run(serverName);
        return result.changes > 0;
    }

    private ensureSchema(): void {
        this.db!.exec(`
      CREATE TABLE IF NOT EXISTS mcp_client_registrations (
        server_name TEXT PRIMARY KEY, authorization_endpoint TEXT NOT NULL,
        token_endpoint TEXT NOT NULL, registration_endpoint TEXT NOT NULL DEFAULT '',
        issuer TEXT NOT NULL DEFAULT '', scopes_supported TEXT NOT NULL DEFAULT '',
        token_endpoint_auth_methods_supported TEXT NOT NULL DEFAULT 'client_secret_post',
        client_id TEXT NOT NULL DEFAULT '', client_secret TEXT NOT NULL DEFAULT '',
        client_id_issued_at REAL NOT NULL DEFAULT 0,
        client_secret_expires_at REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    }
}
