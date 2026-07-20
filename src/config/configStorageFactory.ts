/**
 * Factory for building OrchidConfigStorage instances from config.
 */

import type { OrchidConfigStorageConfig } from "./schema/storage.js";
import type { OrchidConfigStorage } from "./storage.js";
import { OrchidSQLiteConfigStorage } from "./configStorageSqlite.js";

export function buildConfigStorageFromConfig(config: OrchidConfigStorageConfig | undefined): OrchidConfigStorage | null {
    if (!config || !config.enabled) {
        return null;
    }

    const classPath = config.class || "";
    const dsn = config.dsn || "";

    if (!dsn) {
        console.warn("[ConfigStorage] config_storage.enabled=true but no dsn provided — skipping");
        return null;
    }

    // Default to SQLite if no class specified or if it's the SQLite class
    if (!classPath || classPath.includes("SQLite") || classPath.includes("sqlite")) {
        return new OrchidSQLiteConfigStorage({ dsn });
    }

    // For other classes, we'd need dynamic import — for now, just support SQLite
    console.warn("[ConfigStorage] Unsupported config_storage class: %s — using SQLite", classPath);
    return new OrchidSQLiteConfigStorage({ dsn });
}
