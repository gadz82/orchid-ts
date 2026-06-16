/** Graph Store ABC — entity/edge CRUD for RAG graph strategies. */
import type { OrchidRAGScope } from "./scopes.js";

export interface OrchidEntity {
    id: string;
    type: string;
    name: string;
    properties?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface OrchidEdge {
    sourceId: string;
    targetId: string;
    relation: string;
    properties?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export abstract class OrchidEntityExtractor {
    abstract extract(
        text: string,
        opts: {
            chatModel: unknown;
            schema?: Record<string, unknown> | null;
        },
    ): Promise<{ entities: OrchidEntity[]; edges: OrchidEdge[] }>;
}

export abstract class OrchidGraphStore {
    static isNull = false;

    abstract upsertEntities(entities: OrchidEntity[], scope: OrchidRAGScope): Promise<void>;
    abstract upsertEdges(edges: OrchidEdge[], scope: OrchidRAGScope): Promise<void>;
    abstract findEntities(
        query: string,
        scope: OrchidRAGScope,
        typeFilter?: string[] | null,
        k?: number,
    ): Promise<OrchidEntity[]>;
    abstract neighbours(
        entityIds: string[],
        scope: OrchidRAGScope,
        maxHops?: number,
        relationFilter?: string[] | null,
    ): Promise<{ entities: OrchidEntity[]; edges: OrchidEdge[] }>;
    abstract close(): Promise<void>;
}
