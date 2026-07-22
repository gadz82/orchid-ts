import { OrchidRuntime } from "./runtime.js";
import { OrchidInvoker, OrchidInvokeResult, OrchidPendingApproval } from "./invoker.js";
import { OrchidFactoryOverrides } from "./overrides.js";
import type { OrchidAuthContext, OrchidAgentState } from "../core/index.js";

export class Orchid {
    private invoker: OrchidInvoker;
    private chatRepo: any | null = null;
    private sessionWarmer: any | null = null;
    private closed = false;

    constructor(opts: { runtime: OrchidRuntime; chatRepo?: any | null; graph?: any | null }) {
        this._runtime = opts.runtime;
        this.chatRepo = opts.chatRepo ?? null;
        this._graph = opts.graph ?? null;
        this.invoker = new OrchidInvoker({
            graph: this._graph,
            chatRepo: this.chatRepo,
            checkpointer: this._runtime.checkpointer,
        });
    }

    private _runtime: OrchidRuntime;

    get runtime(): OrchidRuntime {
        return this._runtime;
    }

    private _graph: any | null = null;

    get graph(): any {
        return this._graph;
    }

    get chatStorage(): any {
        return this._runtime.chatStorage;
    }

    get reader(): any {
        return this._runtime.reader;
    }

    static async fromConfigPath(
        configPath: string,
        overrides?: Partial<OrchidFactoryOverrides>,
    ): Promise<Orchid> {
        const { loadConfig } = await import("../config/loader.js");
        let config = await loadConfig(configPath);

        const { dirname, resolve: resolvePath } = await import("node:path");
        const configDir = dirname(
            configPath.startsWith("/") || /^[A-Z]:/.test(configPath)
                ? configPath
                : resolvePath(process.cwd(), configPath),
        );

        // Build content sources from CONTENT_SOURCES env var (set by applyYamlToEnv)
        let contentSources: any[] | null = null;
        try {
            const { buildContentSourcesFromEnv } = await import("../content/index.js");
            contentSources = buildContentSourcesFromEnv(configDir);
            if (contentSources && contentSources.length > 0) {
                console.info("[Orchid] built %d content source(s) from config", contentSources.length);
            }
        } catch (err) {
            console.warn("[Orchid] Failed to build content sources: %s", err);
        }

        // Resolve checkpointer type / dsn from overrides (Python parity:
        // `_build_runtime` -> `_attach_checkpointer`). Default is empty
        // (no checkpointer) — without a checkpointer, the caller must
        // inject prior conversation history into the initial state.
        const cpType = overrides?.checkpointer?.checkpointerType ?? "";
        const cpDsn = overrides?.checkpointer?.checkpointerDsn ?? "";

        let checkpointer: unknown = null;
        if (cpType) {
            try {
                const { buildCheckpointer } = await import("../checkpointing/factory.js");
                checkpointer = await buildCheckpointer(cpType, cpDsn || undefined);
                console.info("[Orchid] checkpointer=%s ready", cpType);
            } catch (exc: unknown) {
                const err = exc instanceof Error ? exc : new Error(String(exc));
                console.warn("[Orchid] checkpointer build failed: %s", err.message);
            }
        }

        // Build config storage if enabled
        let configStorage: any = null;
        try {
            const { buildConfigStorageFromConfig } = await import("../config/configStorageFactory.js");
            configStorage = buildConfigStorageFromConfig(config.configStorage);
            if (configStorage) {
                await configStorage.initDb();
                console.info("[Orchid] config storage initialised");
            }
        } catch (err) {
            console.warn("[Orchid] Failed to build config storage: %s", err);
        }

        const runtime = new OrchidRuntime({
            defaultModel: overrides?.model ?? "ollama/llama3.2",
            configDir,
            checkpointer,
            contentSources,
        });

        // Build vector reader from overrides (if a backend is configured)
        const vectorBackend = overrides?.vectorBackend ?? "";
        if (vectorBackend && vectorBackend !== "null") {
            try {
                const { buildReader } = await import("../rag/factory.js");
                runtime.reader = buildReader({
                    vectorBackend,
                    qdrantUrl: overrides?.qdrantUrl ?? "",
                    embeddingModel: overrides?.embeddingModel ?? "",
                });
                console.info("[Orchid] vector reader built: backend=%s", vectorBackend);
            } catch (err) {
                console.warn("[Orchid] Failed to build vector reader: %s", err);
            }
        }

        // Build chat model from overrides
        const model = overrides?.model ?? "";
        if (model) {
            try {
                const { buildChatModel } = await import("../llm/factory.js");
                const chatModel = await buildChatModel(model);
                if (chatModel) runtime.chatModel = chatModel;
            } catch {
                // Chat model build is best-effort here; buildGraph will retry
            }
        }

        // Build chat storage from config
        if (config.chatStorage?.class) {
            try {
                const { buildChatStorage } = await import("../persistence/factory.js");
                runtime.chatStorage = buildChatStorage(
                    config.chatStorage.class,
                    config.chatStorage.dsn || "",
                );
                // Initialize the database
                if (typeof runtime.chatStorage.initDb === "function") {
                    await runtime.chatStorage.initDb();
                }
                console.info("[Orchid] chat storage built: class=%s", config.chatStorage.class);
            } catch (err) {
                console.warn("[Orchid] Failed to build chat storage: %s", err);
            }
        }

        // Run startup hooks if configured
        if (config.startupHooks && Array.isArray(config.startupHooks)) {
            await this._runStartupHooks(config.startupHooks, {
                config,
                runtime,
                configStorage,
                configDir,
            });
        }

        // Merge configs from DB into the graph config
        if (configStorage) {
            config = await this._mergeFromDb(config, configStorage);
        }

        let graph: any = null;
        try {
            const { buildGraph } = await import("../graph/builder.js");
            graph = await buildGraph({ config, runtime });
        } catch (exc: unknown) {
            const err = exc instanceof Error ? exc : new Error(String(exc));
            console.warn("buildGraph not available, continuing without compiled graph");
            console.error("buildGraph error:", err.message);
            if (err.stack) console.error(err.stack);
        }

        const orchid = new Orchid({ runtime, graph });
        (orchid as any)._configStorage = configStorage;
        // Expose configStorage as a public property for startup hooks
        Object.defineProperty(orchid, "configStorage", {
            get: () => configStorage,
            enumerable: true,
        });
        return orchid;
    }

    static async fromConfig(
        config: any,
        runtimeOverrides?: Partial<OrchidRuntime>,
    ): Promise<Orchid> {
        const runtime = new OrchidRuntime(runtimeOverrides);

        let graph: any = null;
        try {
            const { buildGraph } = await import("../graph/builder.js");
            graph = await buildGraph({ config, runtime });
        } catch {
            // buildGraph not available
        }
        return new Orchid({ runtime, graph });
    }

    async invoke(
        input: OrchidAgentState,
        config?: Record<string, unknown>,
    ): Promise<OrchidInvokeResult> {
        this.ensureOpen();
        // Pass the full state through to the invoker so the human
        // message in `input.messages` is preserved (the previous
        // implementation extracted only `input.message` (a string) and
        // rebuilt a new state, silently dropping the prepared history
        // and the user query injected by the API's `prepareGraphState`).
        return await this.invoker.invokeState(input, {
            chatId: (config as any)?.configurable?.thread_id ?? null,
            auth: (config as any)?.configurable?.auth_context as OrchidAuthContext,
        });
    }

    async stream(
        input: OrchidAgentState,
        config?: Record<string, unknown>,
    ): Promise<AsyncIterable<[string, unknown]>> {
        this.ensureOpen();
        return await this.invoker.streamState(input, {
            chatId: (config as any)?.configurable?.thread_id ?? null,
            auth: (config as any)?.configurable?.auth_context as OrchidAuthContext,
        });
    }

    async resume(
        threadId: string,
        approval: {
            tool: string;
            args: Record<string, unknown>;
            agent: string;
            approved: boolean;
        },
        config?: Record<string, unknown>,
    ): Promise<OrchidInvokeResult> {
        this.ensureOpen();
        return await this.invoker.resume({
            chatId: threadId,
            auth: (config as any)?.configurable?.auth_context as OrchidAuthContext,
            approved: approval.approved,
        });
    }

    async warmUnauthenticatedCapabilities(): Promise<void> {
        this.ensureOpen();
        if (this.sessionWarmer) {
            await this.sessionWarmer.warmUnauthenticated();
        }
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        try {
            if (this._runtime.checkpointer) {
                const { shutdownCheckpointer } = await import("../checkpointing/factory.js");
                await shutdownCheckpointer(this._runtime.checkpointer);
            }
            if (this.chatRepo?.close) await this.chatRepo.close();
            if (this._runtime.mcpTokenStore?.close) await this._runtime.mcpTokenStore.close();
        } catch {
            // Best effort
        }
    }

    private ensureOpen(): void {
        if (this.closed) throw new Error("Orchid instance has been closed");
    }

    private static async _runStartupHooks(
        hooks: string[],
        context: {
            config: any;
            runtime: any;
            configStorage: any;
            configDir: string;
        },
    ): Promise<void> {
        const { resolve: resolvePath } = await import("node:path");

        for (const hookPath of hooks) {
            try {
                const absolutePath = hookPath.startsWith(".")
                    ? resolvePath(context.configDir, hookPath)
                    : hookPath;
                const hookModule = await import(absolutePath);
                const hookFn = hookModule.default || hookModule.buildFleet || hookModule.startup;

                if (typeof hookFn === "function") {
                    console.info("[Orchid] Running startup hook: %s", hookPath);
                    await hookFn({
                        config: context.config,
                        runtime: context.runtime,
                        configStorage: context.configStorage,
                        settings: {},
                    });
                } else {
                    console.warn("[Orchid] Startup hook %s does not export a function", hookPath);
                }
            } catch (err) {
                console.error("[Orchid] Startup hook %s failed: %s", hookPath, err);
            }
        }
    }

    private static async _mergeFromDb(config: any, configStorage: any): Promise<any> {
        try {
            const records = await configStorage.listConfigs();
            if (!records || records.length === 0) {
                return config;
            }

            console.info("[Orchid] Merging %d agent config(s) from database", records.length);

            const agents = { ...(config.agents || {}) };
            for (const record of records) {
                const agentConfig = record.config;
                if (agents[record.name]) {
                    console.warn("[Orchid] Agent %s exists in both YAML and DB — DB version takes precedence", record.name);
                }
                agents[record.name] = agentConfig;
            }

            return { ...config, agents };
        } catch (err) {
            console.warn("[Orchid] Failed to merge configs from DB: %s", err);
            return config;
        }
    }
}

export { OrchidInvokeResult, OrchidPendingApproval, OrchidFactoryOverrides, OrchidRuntime };
export {
    StorageOverrides,
    MCPStorageOverrides,
    CheckpointerOverrides,
    StartupOverrides,
} from "./overrides.js";
