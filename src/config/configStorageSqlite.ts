/**
 * SQLite config storage — built-in lightweight OrchidConfigStorage implementation.
 *
 * Uses better-sqlite3 (synchronous) wrapped in async methods for API compatibility.
 * The `agent_configs` table DDL is created during initDb().
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { OrchidAgentConfigRecord, OrchidConfigStorage } from "./storage.js";

function deepMerge(
    base: Record<string, unknown>,
    overlay: Record<string, unknown>,
): Record<string, unknown> {
    const result = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        if (
            key in result &&
            result[key] !== null &&
            typeof result[key] === "object" &&
            !Array.isArray(result[key]) &&
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        ) {
            result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}

export class OrchidSQLiteConfigStorage implements OrchidConfigStorage {
    private _db: Database.Database | null = null;
    private readonly _dbPath: string;

    constructor(opts: { dsn: string }) {
        this._dbPath = resolve(opts.dsn.replace(/^~/, process.env.HOME || "~"));
    }

    async initDb(): Promise<void> {
        if (this._db) return;

        // Ensure directory exists
        const dir = dirname(this._dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        this._db = new Database(this._dbPath);
        this._db.pragma("journal_mode = WAL");
        this._db.pragma("foreign_keys = ON");

        // Create agent_configs table
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS agent_configs (
                name TEXT PRIMARY KEY,
                config TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    async close(): Promise<void> {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    }

    async listConfigs(): Promise<OrchidAgentConfigRecord[]> {
        if (!this._db) return [];

        const rows = this._db
            .prepare("SELECT name, config, created_at, updated_at FROM agent_configs ORDER BY updated_at DESC")
            .all() as Array<{ name: string; config: string; created_at: string; updated_at: string }>;

        return rows.map((row) => ({
            name: row.name,
            config: JSON.parse(row.config),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }

    async getConfig(name: string): Promise<OrchidAgentConfigRecord | null> {
        if (!this._db) return null;

        const row = this._db
            .prepare("SELECT name, config, created_at, updated_at FROM agent_configs WHERE name = ?")
            .get(name) as { name: string; config: string; created_at: string; updated_at: string } | undefined;

        if (!row) return null;

        return {
            name: row.name,
            config: JSON.parse(row.config),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async upsertConfig(name: string, config: Record<string, unknown>): Promise<OrchidAgentConfigRecord> {
        if (!this._db) {
            throw new Error("SQLiteConfigStorage: not initialised. Call initDb() first.");
        }

        const now = new Date().toISOString();
        const configJson = JSON.stringify(config);

        this._db
            .prepare(
                `INSERT INTO agent_configs (name, config, created_at, updated_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET
                     config = excluded.config,
                     updated_at = excluded.updated_at`,
            )
            .run(name, configJson, now, now);

        return {
            name,
            config,
            createdAt: now,
            updatedAt: now,
        };
    }

    async patchConfig(name: string, patch: Record<string, unknown>): Promise<OrchidAgentConfigRecord | null> {
        if (!this._db) {
            throw new Error("SQLiteConfigStorage: not initialised. Call initDb() first.");
        }

        const existing = await this.getConfig(name);
        if (!existing) return null;

        const merged = deepMerge(existing.config, patch);
        const now = new Date().toISOString();
        const configJson = JSON.stringify(merged);

        this._db.prepare("UPDATE agent_configs SET config = ?, updated_at = ? WHERE name = ?").run(configJson, now, name);

        return {
            name,
            config: merged,
            createdAt: existing.createdAt,
            updatedAt: now,
        };
    }

    async deleteConfig(name: string): Promise<void> {
        if (!this._db) return;

        this._db.prepare("DELETE FROM agent_configs WHERE name = ?").run(name);
    }
}
