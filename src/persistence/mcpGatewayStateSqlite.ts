import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
    OrchidMCPGatewayClientStore,
    OrchidMCPGatewayAuthCodeStore,
    OrchidMCPGatewayTokenStore,
} from "../core/mcpGatewayState.js";
import type {
    OrchidMCPGatewayClient,
    OrchidMCPGatewayAuthCode,
    OrchidMCPGatewayToken,
} from "../core/mcpGatewayState.js";

function isMemoryDb(path: string): boolean {
    return path === ":memory:" || path.startsWith(":memory:?") || path.includes(":memory:");
}

export class OrchidSQLiteMCPGatewayStateStore
    extends OrchidMCPGatewayAuthCodeStore
    implements OrchidMCPGatewayClientStore, OrchidMCPGatewayTokenStore
{
    private dbPath: string;
    private db: Database.Database | null = null;

    // We extend AuthCodeStore (which has initDb/close), and implement the other two interfaces.
    // All three ABCs define initDb/close, so the abstract contract is satisfied.

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

    async register(client: OrchidMCPGatewayClient): Promise<OrchidMCPGatewayClient> {
        const now = Date.now() / 1000;
        this.db!.prepare(
            "INSERT INTO mcp_gateway_clients (client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
            client.clientId,
            client.metadata?.clientName ?? "",
            JSON.stringify(client.redirectUris),
            JSON.stringify(client.grantTypes ?? []),
            JSON.stringify([]),
            client.tokenEndpointAuthMethod ?? "none",
            now,
        );
        return client;
    }

    // ── OrchidMCPGatewayClientStore ─────────────────

    async get(clientId: string): Promise<OrchidMCPGatewayClient | null> {
        const row = this.db!.prepare("SELECT * FROM mcp_gateway_clients WHERE client_id = ?").get(
            clientId,
        ) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            clientId: row.client_id as string,
            redirectUris: JSON.parse(row.redirect_uris as string),
            grantTypes: JSON.parse(row.grant_types as string),
            tokenEndpointAuthMethod: (row.token_endpoint_auth_method as string) ?? "none",
            createdAt: row.created_at as number,
        };
    }

    async put(authCode: OrchidMCPGatewayAuthCode): Promise<void> {
        const now = Date.now() / 1000;
        this.db!.prepare(
            "INSERT INTO mcp_gateway_auth_codes " +
                "(code, client_id, redirect_uri, code_challenge, code_challenge_method, " +
                " upstream_state, upstream_code_verifier, scopes, client_state, identity, " +
                " idp_access_token, idp_refresh_token, idp_expires_at, created_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
            authCode.code,
            authCode.clientId,
            authCode.redirectUri,
            authCode.codeChallenge ?? "",
            authCode.codeChallengeMethod ?? "S256",
            authCode.upstreamState ?? "",
            "",
            JSON.stringify(authCode.scope ?? ""),
            "",
            null,
            authCode.idpAccessToken ?? "",
            authCode.idpRefreshToken ?? "",
            authCode.idpExpiresAt ?? 0,
            now,
        );
    }

    // ── OrchidMCPGatewayAuthCodeStore ───────────────

    async getByUpstreamState(upstreamState: string): Promise<OrchidMCPGatewayAuthCode | null> {
        const row = this.db!.prepare(
            "SELECT * FROM mcp_gateway_auth_codes WHERE upstream_state = ?",
        ).get(upstreamState) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            code: row.code as string,
            clientId: row.client_id as string,
            redirectUri: row.redirect_uri as string,
            codeChallenge: row.code_challenge as string,
            codeChallengeMethod: row.code_challenge_method as string,
            upstreamState: row.upstream_state as string,
            scope: row.scopes as string,
            idpAccessToken: row.idp_access_token as string,
            idpRefreshToken: row.idp_refresh_token as string,
            idpExpiresAt: row.idp_expires_at as number,
            expiresAt: (row.created_at as number) + 600,
            consumed: false,
            createdAt: row.created_at as number,
        };
    }

    async update(code: string, patch: Partial<OrchidMCPGatewayAuthCode>): Promise<void> {
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (patch.idpAccessToken !== undefined) {
            sets.push("idp_access_token = ?");
            vals.push(patch.idpAccessToken);
        }
        if (patch.idpRefreshToken !== undefined) {
            sets.push("idp_refresh_token = ?");
            vals.push(patch.idpRefreshToken);
        }
        if (patch.idpExpiresAt !== undefined) {
            sets.push("idp_expires_at = ?");
            vals.push(patch.idpExpiresAt);
        }
        if (patch.consumed !== undefined) {
            sets.push("consumed = ?");
            vals.push(patch.consumed ? 1 : 0);
        }
        if (sets.length === 0) return;
        vals.push(code);
        this.db!.prepare(`UPDATE mcp_gateway_auth_codes SET ${sets.join(", ")} WHERE code = ?`).run(
            ...vals,
        );
    }

    async consume(code: string): Promise<OrchidMCPGatewayAuthCode | null> {
        const row = this.db!.prepare("SELECT * FROM mcp_gateway_auth_codes WHERE code = ?").get(
            code,
        ) as Record<string, unknown> | undefined;
        if (!row) return null;
        this.db!.prepare("DELETE FROM mcp_gateway_auth_codes WHERE code = ?").run(code);
        return {
            code: row.code as string,
            clientId: row.client_id as string,
            redirectUri: row.redirect_uri as string,
            codeChallenge: row.code_challenge as string,
            codeChallengeMethod: row.code_challenge_method as string,
            upstreamState: row.upstream_state as string,
            scope: row.scopes as string,
            idpAccessToken: row.idp_access_token as string,
            idpRefreshToken: row.idp_refresh_token as string,
            idpExpiresAt: row.idp_expires_at as number,
            expiresAt: (row.created_at as number) + 600,
            consumed: true,
            createdAt: row.created_at as number,
        };
    }

    async issue(token: OrchidMCPGatewayToken): Promise<OrchidMCPGatewayToken> {
        this.db!.prepare(
            "INSERT INTO mcp_gateway_tokens " +
                "(access_token, refresh_token, client_id, subject, identity, scopes, expires_at, " +
                " idp_access_token, idp_refresh_token, idp_expires_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
            token.accessToken,
            token.refreshToken ?? "",
            token.clientId,
            token.userId ?? "",
            JSON.stringify({ userId: token.userId, tenantId: token.tenantId }),
            JSON.stringify(token.scope ?? ""),
            token.expiresAt ?? 0,
            token.idpAccessToken ?? "",
            token.idpRefreshToken ?? "",
            token.idpExpiresAt ?? 0,
        );
        return token;
    }

    // ── OrchidMCPGatewayTokenStore ──────────────────

    async getByAccessToken(accessToken: string): Promise<OrchidMCPGatewayToken | null> {
        const row = this.db!.prepare("SELECT * FROM mcp_gateway_tokens WHERE access_token = ?").get(
            accessToken,
        ) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            accessToken: row.access_token as string,
            refreshToken: row.refresh_token as string,
            clientId: row.client_id as string,
            scope: row.scopes as string,
            expiresAt: row.expires_at as number,
            idpAccessToken: row.idp_access_token as string,
            idpRefreshToken: row.idp_refresh_token as string,
            idpExpiresAt: row.idp_expires_at as number,
        };
    }

    async getByRefreshToken(refreshToken: string): Promise<OrchidMCPGatewayToken | null> {
        const row = this.db!.prepare(
            "SELECT * FROM mcp_gateway_tokens WHERE refresh_token = ?",
        ).get(refreshToken) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            accessToken: row.access_token as string,
            refreshToken: row.refresh_token as string,
            clientId: row.client_id as string,
            scope: row.scopes as string,
            expiresAt: row.expires_at as number,
            idpAccessToken: row.idp_access_token as string,
            idpRefreshToken: row.idp_refresh_token as string,
            idpExpiresAt: row.idp_expires_at as number,
        };
    }

    async revoke(accessToken: string): Promise<boolean> {
        const result = this.db!.prepare(
            "DELETE FROM mcp_gateway_tokens WHERE access_token = ?",
        ).run(accessToken);
        return result.changes > 0;
    }

    private ensureSchema(): void {
        this.db!.exec(`
      CREATE TABLE IF NOT EXISTS mcp_gateway_clients (
        client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL DEFAULT '',
        redirect_uris TEXT NOT NULL, grant_types TEXT NOT NULL,
        response_types TEXT NOT NULL, token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
        created_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_gateway_auth_codes (
        code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL, code_challenge_method TEXT NOT NULL,
        upstream_state TEXT NOT NULL UNIQUE, upstream_code_verifier TEXT NOT NULL,
        scopes TEXT NOT NULL, client_state TEXT NOT NULL DEFAULT '',
        identity TEXT, idp_access_token TEXT NOT NULL DEFAULT '',
        idp_refresh_token TEXT NOT NULL DEFAULT '', idp_expires_at REAL NOT NULL DEFAULT 0,
        created_at REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_gateway_auth_codes_created_at ON mcp_gateway_auth_codes (created_at);
      CREATE TABLE IF NOT EXISTS mcp_gateway_tokens (
        access_token TEXT PRIMARY KEY, refresh_token TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL, subject TEXT NOT NULL, identity TEXT NOT NULL,
        scopes TEXT NOT NULL, expires_at REAL NOT NULL,
        idp_access_token TEXT NOT NULL DEFAULT '', idp_refresh_token TEXT NOT NULL DEFAULT '',
        idp_expires_at REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_gateway_tokens_expires_at ON mcp_gateway_tokens (expires_at);
    `);
    }
}
