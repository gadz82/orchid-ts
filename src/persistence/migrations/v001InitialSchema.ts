export interface Migration {
    version: string;
    description: string;
    up: (db: unknown, dialect: string) => Promise<void>;
    down: (db: unknown, dialect: string) => Promise<void>;
}

const EXTRA_NAMESPACE_PREFIX = "ext:";

const FRAMEWORK_MIGRATIONS: Migration[] = [
    {
        version: "001",
        description: "SQLite initial schema (chat, MCP outbound, MCP inbound gateway, events)",
        up: async (db, _dialect) => {
            const d = db as { exec(sql: string): void };
            d.exec(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, is_shared INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions (tenant_id, user_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL, content TEXT NOT NULL, agents_used TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_messages_chat ON chat_messages (chat_id, created_at ASC);
        CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
          server_name TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
          access_token TEXT NOT NULL, refresh_token TEXT NOT NULL DEFAULT '',
          expires_at REAL NOT NULL DEFAULT 0, scopes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (server_name, tenant_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_oauth_tokens (tenant_id, user_id);
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
        CREATE TABLE IF NOT EXISTS conversation_summaries (
          chat_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
          summary_text TEXT NOT NULL, turn_number INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
        },
        down: async (db, _dialect) => {
            const d = db as { exec(sql: string): void };
            d.exec(`
        DROP TABLE IF EXISTS conversation_summaries;
        DROP TABLE IF EXISTS mcp_gateway_tokens;
        DROP TABLE IF EXISTS mcp_gateway_auth_codes;
        DROP TABLE IF EXISTS mcp_gateway_clients;
        DROP TABLE IF EXISTS mcp_client_registrations;
        DROP TABLE IF EXISTS mcp_oauth_tokens;
        DROP TABLE IF EXISTS chat_messages;
        DROP TABLE IF EXISTS chat_sessions;
      `);
        },
    },
];

export { EXTRA_NAMESPACE_PREFIX, FRAMEWORK_MIGRATIONS };

export function getMigrations(): Migration[] {
    return [...FRAMEWORK_MIGRATIONS];
}
