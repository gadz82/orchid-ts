import { OrchidVectorReader } from "../../core/repository.js";
import type {
    OrchidSearchResult,
    OrchidDocument,
    OrchidMetadataFilters,
} from "../../core/repository.js";
import type { OrchidRAGScope } from "../../core/scopes.js";
import type { OrchidSparseVector } from "../../core/sparse.js";
import { OrchidDocStore } from "../../core/docStore.js";
import { OrchidGraphStore } from "../../core/graphStore.js";
import type { OrchidEntity, OrchidEdge } from "../../core/graphStore.js";

let _nullReaderWarned = false;

export class NullVectorReader extends OrchidVectorReader {
    override async retrieve(
        _query: string,
        _namespace: string,
        _k?: number,
        _scope?: OrchidRAGScope | null,
        _metadataFilters?: OrchidMetadataFilters | null,
    ): Promise<OrchidSearchResult[]> {
        if (!_nullReaderWarned) {
            console.warn(
                "[NullVectorReader] retrieve() called — no vector backend configured. " +
                    "RAG queries will return empty results. " +
                    "Install a vector plugin or set vector_backend in your config.",
            );
            _nullReaderWarned = true;
        }
        return [];
    }

    override async retrieveSparse(
        _querySparse: OrchidSparseVector,
        _namespace: string,
        _k?: number,
        _scope?: OrchidRAGScope | null,
        _metadataFilters?: OrchidMetadataFilters | null,
    ): Promise<OrchidSearchResult[]> {
        return [];
    }

    override async lookupCachedToolResults(
        _namespace: string,
        _scope: OrchidRAGScope,
        _toolName: string,
        _minInjectedAt: number,
    ): Promise<string | null> {
        return null;
    }
}

export class NullDocStore extends OrchidDocStore {
    get isNull(): boolean {
        return true;
    }

    override async put(_doc: OrchidDocument): Promise<void> {
        return undefined;
    }

    override async get(_docId: string): Promise<OrchidDocument | null> {
        return null;
    }

    override async getMany(_docIds: string[]): Promise<OrchidDocument[]> {
        return [];
    }
}

export class NullGraphStore extends OrchidGraphStore {
    get isNull(): boolean {
        return true;
    }

    override async upsertEntities(
        _entities: OrchidEntity[],
        _scope: OrchidRAGScope,
    ): Promise<void> {
        return undefined;
    }

    override async upsertEdges(_edges: OrchidEdge[], _scope: OrchidRAGScope): Promise<void> {
        return undefined;
    }

    override async findEntities(
        _query: string,
        _scope: OrchidRAGScope,
        _typeFilter?: string[] | null,
        _k?: number,
    ): Promise<OrchidEntity[]> {
        return [];
    }

    override async neighbours(
        _entityIds: string[],
        _scope: OrchidRAGScope,
        _maxHops?: number,
        _relationFilter?: string[] | null,
    ): Promise<{ entities: OrchidEntity[]; edges: OrchidEdge[] }> {
        return { entities: [], edges: [] };
    }

    override async close(): Promise<void> {
        return undefined;
    }
}
