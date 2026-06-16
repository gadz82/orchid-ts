import type { OrchidMCPTokenStore } from "../core/mcpTokens.js";
import { OrchidSQLiteMCPTokenStore } from "./mcpTokenSqlite.js";

const BUILTIN_SHORTCUTS: Record<string, new (dsn: string) => OrchidMCPTokenStore> = {
    sqlite: OrchidSQLiteMCPTokenStore,
};

export function buildMCPTokenStore(classPath: string, dsn: string): OrchidMCPTokenStore {
    if (classPath in BUILTIN_SHORTCUTS) {
        return new BUILTIN_SHORTCUTS[classPath](dsn);
    }

    throw new Error(
        `Cannot resolve MCP token store class '${classPath}'. Built-in shortcuts: sqlite.`,
    );
}
