/** RagPipeline — owns RAG retrieval, cache check, and dynamic injection. */
import type { OrchidVectorReader, ChatModelLike, OrchidRAGScope } from "../core/index.js";

type EffectiveRagResolver = (toolName: string) => {
    namespace?: string;
    ingestion: { [key: string]: unknown };
} | null;

export class RagPipeline {
    private reader: OrchidVectorReader;
    private chatModel: ChatModelLike | null;
    private graphStore: unknown;

    constructor(opts: {
        reader: OrchidVectorReader;
        chatModel?: ChatModelLike | null;
        graphStore?: unknown;
    }) {
        this.reader = opts.reader;
        this.chatModel = opts.chatModel ?? null;
        this.graphStore = opts.graphStore ?? null;
    }

    async retrieve(opts: {
        query: string;
        scope: OrchidRAGScope;
        ragNamespace: string;
        k: number;
        enabled: boolean;
        retrievalStrategy?: string;
        retrievalConfig?: Record<string, unknown> | null;
        excludeDynamic?: boolean;
    }): Promise<Array<Record<string, unknown>>> {
        if (!opts.enabled) return [];

        const strategyName = opts.retrievalStrategy || "simple";

        // @ts-ignore — module built in later phase
        const { getRetrievalStrategy } = await import("../rag/strategies/index.js");
        const strategy = getRetrievalStrategy(strategyName, opts.retrievalConfig ?? null);

        const retrievalCfg = opts.retrievalConfig as Record<string, unknown> | undefined;
        const promptsCfg = retrievalCfg?.transformer_prompts as Record<string, unknown> | undefined;

        const queryTransformers = retrievalCfg?.query_transformers as string[] | undefined;

        // @ts-ignore — module built in later phase
        const transformers = await import("../rag/transformers/index.js");
        const { TRANSFORMER_REGISTRY, getQueryTransformer, resolveTransformerKwargs } =
            transformers;

        const strategyTransformers = (queryTransformers ?? [])
            .filter((name) => !(TRANSFORMER_REGISTRY[name] as any)?.preStrategy)
            .map((name) =>
                getQueryTransformer(name, resolveTransformerKwargs(name, promptsCfg ?? null)),
            );

        let configuredFilters: Record<string, unknown> =
            (retrievalCfg?.metadata_filters as Record<string, unknown>) ?? {};
        if (opts.excludeDynamic) {
            configuredFilters = { ...configuredFilters, dynamic: { not: true } };
        }
        const metadataFilters =
            Object.keys(configuredFilters).length > 0 ? configuredFilters : null;

        const commonKwargs: Record<string, unknown> = {
            query: opts.query,
            scope: opts.scope,
            k: opts.k,
            reader: this.reader,
            chatModel: this.chatModel,
            transformers: strategyTransformers,
            metadataFilters,
            graphStore: this.graphStore,
        };

        const [domainResults, uploadResults] = await Promise.all([
            strategy.retrieve(
                opts.query,
                opts.scope,
                this.reader,
                opts.ragNamespace,
                opts.k,
                commonKwargs,
            ),
            strategy.retrieve(opts.query, opts.scope, this.reader, "uploads", opts.k, commonKwargs),
        ]);

        const combined: Array<Record<string, unknown>> = [];
        for (const r of [...domainResults, ...uploadResults]) {
            const doc: Record<string, unknown> = (r as any).document as Record<string, unknown>;
            const metadata = (doc?.metadata ?? {}) as Record<string, unknown>;
            const content =
                (metadata["parent_content"] as string) ?? (doc?.pageContent as string) ?? "";
            combined.push({
                content,
                score: Math.round(((r as any).score as number) * 1000) / 1000,
                metadata: Object.fromEntries(
                    Object.entries(metadata).filter(
                        ([k]) => k !== "content" && k !== "embedding" && k !== "parent_content",
                    ),
                ),
            });
        }

        combined.sort((a, b) => ((b.score as number) ?? 0) - ((a.score as number) ?? 0));
        return combined.slice(0, opts.k);
    }

    async checkCache(opts: {
        scope: OrchidRAGScope;
        ragNamespace: string;
        enabled: boolean;
        toolTtls?: Record<string, number> | null;
    }): Promise<Record<string, unknown>> {
        if (!opts.enabled || !opts.toolTtls) return {};
        return this.lookupCachedTools(opts.scope, opts.ragNamespace, opts.toolTtls);
    }

    async inject(opts: {
        mcpData: Record<string, unknown>;
        scope: OrchidRAGScope;
        ragNamespace: string;
        enabled: boolean;
        injectableTools?: Set<string> | null;
        effectiveRagResolver?: EffectiveRagResolver | null;
    }): Promise<void> {
        if (!opts.enabled || !opts.injectableTools) return;

        for (const [toolName, toolResult] of Object.entries(opts.mcpData)) {
            const toolSet = opts.injectableTools;
            if (!toolSet.has(toolName) && !toolSet.has(`builtin_${toolName}`)) {
                continue;
            }

            if (!opts.effectiveRagResolver) continue;

            const effective = opts.effectiveRagResolver(toolName);
            if (!effective) continue;

            const targetNamespace = effective.namespace || opts.ragNamespace;

            // @ts-ignore — module built in later phase
            const { buildIngestionStrategy } = await import("../documents/strategies/index.js");
            const ingestion = buildIngestionStrategy(effective.ingestion);

            // @ts-ignore — module built in later phase
            const { injectToRag } = await import("../rag/dynamic.js");
            await injectToRag(this.reader, {
                toolName,
                toolResult,
                namespace: targetNamespace,
                scope: opts.scope,
                ingestion,
            });
        }
    }

    private async lookupCachedTools(
        scope: OrchidRAGScope,
        namespace: string,
        toolTtls: Record<string, number>,
    ): Promise<Record<string, unknown>> {
        const lookup = async (toolName: string, ttl: number): Promise<[string, string | null]> => {
            const minTime = Date.now() / 1000 - ttl;
            const result = await this.reader.lookupCachedToolResults(
                namespace,
                scope,
                toolName,
                minTime,
            );
            if (result !== null) {
                console.info("Cache hit for tool '%s' (TTL=%ds)", toolName, ttl);
            }
            return [toolName, result];
        };

        const pairs = await Promise.all(
            Object.entries(toolTtls).map(([name, ttl]) => lookup(name, ttl)),
        );

        const hits: Record<string, unknown> = {};
        for (const [name, val] of pairs) {
            if (val !== null) hits[name] = val;
        }
        return hits;
    }
}
