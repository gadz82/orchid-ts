import { OrchidRetrievalStrategy } from "../../core/retrieval.js";
import type { OrchidQueryTransformer } from "../../core/retrieval.js";
import type { OrchidVectorReader, OrchidSearchResult } from "../../core/repository.js";
import type { OrchidRAGScope } from "../../core/scopes.js";
import { MultiQueryTransformer } from "../transformers/multiQuery.js";
import { expandQueries, fanOutRetrieve } from "./helpers.js";

export class MultiQueryRetrieval extends OrchidRetrievalStrategy {
    private numQueries: number;
    private retrievalTimeoutMs: number;

    constructor({
        numQueries = 3,
        retrievalTimeout = 30,
    }: { numQueries?: number; retrievalTimeout?: number } = {}) {
        super();
        this.numQueries = numQueries;
        this.retrievalTimeoutMs = retrievalTimeout * 1000;
    }

    override get name(): string {
        return "multi_query";
    }

    override async retrieve(
        query: string,
        scope: OrchidRAGScope,
        reader: OrchidVectorReader,
        namespace: string,
        k?: number,
        options?: Record<string, unknown>,
    ): Promise<OrchidSearchResult[]> {
        const chatModel = options?.["chatModel"] as unknown;
        const transformers = options?.["transformers"] as OrchidQueryTransformer[] | undefined;
        const metadataFilters = options?.["metadata_filters"] as any;
        const resolvedK = k ?? 5;
        const queries: string[] = [query];

        if (chatModel) {
            try {
                const variations = await new MultiQueryTransformer({
                    numQueries: this.numQueries,
                }).transform(query, chatModel);
                queries.push(...variations);
            } catch (err) {
                console.warn("[MultiQueryRetrieval] Variation generation failed: %s", err);
            }
        } else {
            console.error(
                "[MultiQueryRetrieval] No chatModel — falling back to single-query retrieval",
            );
        }

        if (transformers && chatModel) {
            queries.push(...(await expandQueries(query, transformers, chatModel)));
        }

        return fanOutRetrieve({
            queries,
            namespace,
            scope,
            k: resolvedK,
            reader,
            timeoutMs: this.retrievalTimeoutMs,
            metadataFilters,
        });
    }
}
