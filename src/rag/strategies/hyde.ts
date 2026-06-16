import { OrchidRetrievalStrategy } from "../../core/retrieval.js";
import type { OrchidQueryTransformer } from "../../core/retrieval.js";
import type { OrchidVectorReader, OrchidSearchResult } from "../../core/repository.js";
import type { OrchidRAGScope } from "../../core/scopes.js";
import { HyDETransformer } from "../transformers/hyde.js";
import { expandQueries, fanOutRetrieve } from "./helpers.js";

export class HyDERetrieval extends OrchidRetrievalStrategy {
    private nHypothetical: number;
    private retrievalTimeoutMs: number;

    constructor({
        nHypothetical = 1,
        retrievalTimeout = 30,
    }: { nHypothetical?: number; retrievalTimeout?: number } = {}) {
        super();
        this.nHypothetical = nHypothetical;
        this.retrievalTimeoutMs = retrievalTimeout * 1000;
    }

    override get name(): string {
        return "hyde";
    }

    static fromConfig(config: unknown): HyDERetrieval {
        const hyde = (config as any)?.hyde;
        const n = hyde?.n_hypothetical ?? 1;
        return new HyDERetrieval({ nHypothetical: n });
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
                const hypotheticals = await new HyDETransformer({
                    nHypothetical: this.nHypothetical,
                }).transform(query, chatModel);
                queries.push(...hypotheticals);
            } catch (err) {
                console.warn("[HyDERetrieval] Hypothetical generation failed: %s", err);
            }
        } else {
            console.error("[HyDERetrieval] No chatModel — skipping hypothetical generation");
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
