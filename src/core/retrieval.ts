/** Retrieval Strategy ABCs for RAG queries. */
import type { OrchidRAGScope } from "./scopes.js";
import type { OrchidSearchResult, OrchidVectorReader } from "./repository.js";

export abstract class OrchidRetrievalStrategy {
    abstract get name(): string;

    abstract retrieve(
        query: string,
        scope: OrchidRAGScope,
        reader: OrchidVectorReader,
        namespace: string,
        k?: number,
        options?: Record<string, unknown>,
    ): Promise<OrchidSearchResult[]>;
}

export abstract class OrchidQueryTransformer {
    abstract get name(): string;

    abstract transform(query: string, chatModel: unknown): Promise<string[]>;
}
