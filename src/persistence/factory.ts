import { OrchidChatStorage } from "./base.js";
import { OrchidSQLiteChatStorage } from "./sqlite.js";

const BUILTIN_SHORTCUTS: Record<string, new (dsn: string) => OrchidChatStorage> = {
    sqlite: OrchidSQLiteChatStorage,
};

export function buildChatStorage(classPath: string, dsn: string): OrchidChatStorage {
    // Check built-in shortcuts first
    if (classPath in BUILTIN_SHORTCUTS) {
        return new BUILTIN_SHORTCUTS[classPath](dsn);
    }

    // Try dynamic import — for external backends
    throw new Error(
        `Cannot resolve chat storage class '${classPath}'. ` +
            `Built-in shortcuts: sqlite. For external backends, install the plugin package. ` +
            `Dynamic import not yet supported in Phase 3.`,
    );
}
