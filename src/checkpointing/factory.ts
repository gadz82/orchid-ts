/**
 * Checkpointer factory — builds a LangGraph-compatible checkpointer
 * from a type hint (memory / sqlite / dotted path) and an optional DSN.
 */

// ── Inline MemorySaver ──────────────────────────────────────────────
// Kept inline so the package works even when @langchain/langgraph is
// not installed.  Implements the minimal checkpointing contract:
//   get(config) → checkpoint | undefined
//   put(config, checkpoint, metadata, newVersions) → void

class MemorySaver {
    private storage: Map<string, unknown> = new Map();

    async get(config: Record<string, unknown>): Promise<unknown> {
        const threadId = (config?.configurable as Record<string, unknown> | undefined)
            ?.thread_id as string | undefined;
        if (!threadId) return undefined;
        return this.storage.get(threadId);
    }

    async put(
        config: Record<string, unknown>,
        checkpoint: unknown,
        _metadata?: unknown,
        _newVersions?: unknown,
    ): Promise<Record<string, unknown>> {
        const threadId = (config?.configurable as Record<string, unknown> | undefined)
            ?.thread_id as string | undefined;
        if (!threadId) return {};
        this.storage.set(threadId, checkpoint);
        return {};
    }
}

// ── Registry for custom checkpointer types ──────────────────────────

export type CheckpointerFactory = (dsn?: string) => Promise<unknown>;

const _checkpointerRegistry = new Map<string, CheckpointerFactory>();

/**
 * Register a named checkpointer factory so that
 * `buildCheckpointer(typeName)` can resolve it.
 */
export function registerCheckpointer(typeName: string, factory: CheckpointerFactory): void {
    _checkpointerRegistry.set(typeName, factory);
}

// ── Builder ─────────────────────────────────────────────────────────

/**
 * Build a checkpointer instance.
 *
 * - `'memory'` → inline `MemorySaver`
 * - `'sqlite'` → `AsyncSqliteSaver` from `@langchain/langgraph-checkpoint-sqlite`
 * - `'postgres'` → `AsyncPostgresSaver` from `@langchain/langgraph-checkpoint-postgres`
 * - dotted path (e.g. `'@myorg/checkpointer#create'`) → dynamic import + instantiate
 * - default (null/undefined) → `MemorySaver`
 *
 * Missing optional dependencies are caught gracefully — the caller
 * receives a clear error with installation instructions rather than
 * a cryptic import failure.
 *
 * @param checkpointerType — type hint string.
 * @param dsn              — connection string for database-backed savers.
 */
export async function buildCheckpointer(checkpointerType?: string, dsn?: string): Promise<unknown> {
    const type = (checkpointerType ?? "").trim().toLowerCase() || "memory";

    // Registered custom factory wins first
    if (_checkpointerRegistry.has(type)) {
        return _checkpointerRegistry.get(type)!(dsn);
    }

    switch (type) {
        case "memory":
            return new MemorySaver();

        case "sqlite": {
            try {
                const mod = (await _dynamicImport(
                    "@langchain/langgraph-checkpoint-sqlite",
                )) as Record<string, unknown>;
                const cls = mod.AsyncSqliteSaver as
                    | { fromConnString(dsn: string): Promise<unknown> }
                    | undefined;
                if (!cls) {
                    throw new Error(
                        "@langchain/langgraph-checkpoint-sqlite did not export AsyncSqliteSaver",
                    );
                }
                return await cls.fromConnString(dsn ?? ":memory:");
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(
                    `Failed to create SQLite checkpointer. ` +
                        `Install @langchain/langgraph-checkpoint-sqlite and ensure ` +
                        `better-sqlite3 is available.  Original error: ${msg}`,
                );
            }
        }

        case "postgres": {
            try {
                const mod = (await _dynamicImport(
                    "@langchain/langgraph-checkpoint-postgres",
                )) as Record<string, unknown>;
                const cls = mod.AsyncPostgresSaver as
                    | { fromConnString(dsn: string): Promise<unknown> }
                    | undefined;
                if (!cls) {
                    throw new Error(
                        "@langchain/langgraph-checkpoint-postgres did not export AsyncPostgresSaver",
                    );
                }
                if (!dsn) {
                    throw new Error(
                        "PostgreSQL checkpointer requires a DSN (database connection string)",
                    );
                }
                return await cls.fromConnString(dsn);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(
                    `Failed to create PostgreSQL checkpointer. ` +
                        `Install @langchain/langgraph-checkpoint-postgres and ensure ` +
                        `the postgres package is available.  Original error: ${msg}`,
                );
            }
        }

        default: {
            // Dotted path — dynamic import
            return _resolveDottedPath(type, dsn);
        }
    }
}

/**
 * Tear down a checkpointer that supports `close()` or `destroy()`.
 * Graceful no-op if the saver has no such method.
 */
export async function shutdownCheckpointer(saver: unknown): Promise<void> {
    if (!saver || typeof saver !== "object") return;

    const obj = saver as Record<string, unknown>;

    try {
        if (typeof obj["close"] === "function") {
            await (obj["close"] as () => Promise<void>)();
            return;
        }
    } catch {
        // Best-effort
    }

    try {
        if (typeof obj["destroy"] === "function") {
            await (obj["destroy"] as () => Promise<void>)();
        }
    } catch {
        // Best-effort
    }
}

// ── Dotted-path resolver ────────────────────────────────────────────

async function _resolveDottedPath(path: string, dsn?: string): Promise<unknown> {
    let modulePath: string;
    let exportName: string;

    if (path.includes("#")) {
        const idx = path.lastIndexOf("#");
        modulePath = path.slice(0, idx);
        exportName = path.slice(idx + 1);
    } else {
        modulePath = path;
        exportName = "default";
    }

    try {
        const mod = await import(modulePath);
        const factory = mod[exportName] ?? mod["default"];
        if (typeof factory !== "function") {
            throw new Error(`Export '${exportName}' from '${modulePath}' is not a function`);
        }
        return factory(dsn);
    } catch (err: unknown) {
        if (
            err instanceof Error &&
            err.message &&
            (err.message.includes("Cannot find module") ||
                err.message.includes("ERR_MODULE_NOT_FOUND"))
        ) {
            throw new Error(
                `Checkpointer module '${modulePath}' could not be loaded. ` +
                    `Ensure the package is installed.`,
            );
        }
        throw err;
    }
}

/**
 * Dynamic import helper that avoids TS module-not-found errors for
 * optional peer dependencies that may not be installed at compile time.
 */
async function _dynamicImport(specifier: string): Promise<unknown> {
     
    return new Function("specifier", "return import(specifier)")(specifier);
}
