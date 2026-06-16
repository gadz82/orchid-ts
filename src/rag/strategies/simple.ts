import { OrchidRetrievalStrategy } from "../../core/retrieval.js";
import type { OrchidQueryTransformer } from "../../core/retrieval.js";
import type {
    OrchidVectorReader,
    OrchidSearchResult,
    OrchidMetadataFilters,
} from "../../core/repository.js";
import type { OrchidRAGScope } from "../../core/scopes.js";

export class SimpleRetrieval extends OrchidRetrievalStrategy {
    override get name(): string {
        return "simple";
    }

    override async retrieve(
        query: string,
        scope: OrchidRAGScope,
        reader: OrchidVectorReader,
        namespace: string,
        k?: number,
        options?: Record<string, unknown>,
    ): Promise<OrchidSearchResult[]> {
        const transformers = options?.["transformers"] as OrchidQueryTransformer[] | undefined;
        const metadataFilters = options?.["metadata_filters"] as OrchidMetadataFilters | undefined;
        const nonPre = (transformers ?? []).filter((t) => !(t as any).preStrategy);
        if (nonPre.length > 0) {
            console.error(
                "[SimpleRetrieval] %d non-pre_strategy transformer(s) supplied but ignored — " +
                    "use strategy: multi_query or hyde for fan-out behaviour.",
                nonPre.length,
            );
        }
        return reader.retrieve(query, namespace, k ?? 5, scope, metadataFilters ?? null);
    }
}
