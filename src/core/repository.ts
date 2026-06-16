/**
 * Vector store abstractions — Interface Segregation.
 *
 * OrchidVectorReader: agents that only retrieve.
 * OrchidVectorWriter: indexers that only write.
 * OrchidVectorStoreAdmin: collection management.
 * OrchidVectorStoreRepository: combines all three.
 */
import type { OrchidRAGScope } from "./scopes.js";
import type { OrchidSparseVector } from "./sparse.js";

/** Framework's canonical document model — no langchain dependency in core/. */
export interface OrchidDocument {
    pageContent: string;
    metadata: Record<string, unknown>;
    id?: string;
}

/** Backwards-compatible alias */
export type Document = OrchidDocument;

/** A document with its relevance score. */
export interface OrchidSearchResult {
    readonly document: OrchidDocument;
    readonly score: number;
}

/** Metadata filter operators */
export interface OrchidMetadataRangeFilter {
    gte?: number;
    lte?: number;
}

export interface OrchidMetadataContainsFilter {
    contains: unknown;
}

export interface OrchidMetadataNegationFilter {
    not: unknown;
}

export type OrchidMetadataFilterValue =
    | string
    | number
    | boolean
    | null
    | string[]
    | number[]
    | OrchidMetadataRangeFilter
    | OrchidMetadataContainsFilter
    | OrchidMetadataNegationFilter;

export type OrchidMetadataFilters = Record<string, OrchidMetadataFilterValue>;

export abstract class OrchidVectorReader {
    abstract retrieve(
        query: string,
        namespace: string,
        k?: number,
        scope?: OrchidRAGScope | null,
        metadataFilters?: OrchidMetadataFilters | null,
    ): Promise<OrchidSearchResult[]>;

    async retrieveSparse(
        _querySparse: OrchidSparseVector,
        _namespace: string,
        _k = 5,
        _scope?: OrchidRAGScope | null,
        _metadataFilters?: OrchidMetadataFilters | null,
    ): Promise<OrchidSearchResult[]> {
        throw new Error(
            `${this.constructor.name} does not support sparse retrieval. Hybrid search requires a backend with a sparse lane.`,
        );
    }

    async lookupCachedToolResults(
        _namespace: string,
        _scope: OrchidRAGScope,
        _toolName: string,
        _minInjectedAt: number,
    ): Promise<string | null> {
        return null;
    }
}

export abstract class OrchidVectorWriter {
    abstract index(documents: OrchidDocument[], namespace: string): Promise<void>;
    abstract upsert(documents: OrchidDocument[], namespace: string): Promise<void>;
    abstract delete(documentIds: string[], namespace: string): Promise<void>;
}

export abstract class OrchidVectorStoreAdmin {
    abstract ensureCollections(namespaces: string[]): Promise<void>;
}

export abstract class OrchidVectorStoreRepository extends OrchidVectorReader {
    static supportsScopePromotion = false;

    abstract index(documents: OrchidDocument[], namespace: string): Promise<void>;
    abstract upsert(documents: OrchidDocument[], namespace: string): Promise<void>;
    abstract delete(documentIds: string[], namespace: string): Promise<void>;
    abstract ensureCollections(namespaces: string[]): Promise<void>;

    async promoteScope({
        namespace: _namespace,
        sourceFilter: _sourceFilter,
        newScopeFields: _newScopeFields,
    }: {
        namespace: string;
        sourceFilter: unknown;
        newScopeFields: Record<string, unknown>;
    }): Promise<number> {
        return 0;
    }
}
