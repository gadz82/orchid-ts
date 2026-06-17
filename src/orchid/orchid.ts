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
        const config = await loadConfig(configPath);

        const runtime = new OrchidRuntime({
            defaultModel: overrides?.model ?? "ollama/llama3.2",
        });

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

        return new Orchid({ runtime, graph });
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
        return await this.invoker.invoke({
            message: (input as any).message ?? "",
            chatId: (config as any)?.configurable?.thread_id ?? null,
            auth: (config as any)?.configurable?.auth_context as OrchidAuthContext,
        });
    }

    async stream(
        input: OrchidAgentState,
        config?: Record<string, unknown>,
    ): Promise<AsyncIterable<[string, unknown]>> {
        this.ensureOpen();
        return await this.invoker.stream({
            message: (input as any).message ?? "",
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
}

export { OrchidInvokeResult, OrchidPendingApproval, OrchidFactoryOverrides, OrchidRuntime };
export {
    StorageOverrides,
    MCPStorageOverrides,
    CheckpointerOverrides,
    StartupOverrides,
} from "./overrides.js";
