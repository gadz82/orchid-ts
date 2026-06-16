/** Ingestion Strategy ABCs for document chunking. */
import type { OrchidRAGScope } from "./scopes.js";
import type { OrchidDocStore } from "./docStore.js";

export interface OrchidChunk {
    text: string;
    metadata: Record<string, unknown>;
}

export abstract class OrchidIngestionStrategy {
    abstract ingest(opts: {
        text: string;
        filename: string;
        scope: OrchidRAGScope;
        docStore?: OrchidDocStore | null;
        embeddings?: unknown;
    }): Promise<OrchidChunk[]>;
}

export abstract class OrchidChunkPostProcessor {
    abstract process(
        chunks: OrchidChunk[],
        opts: {
            text: string;
            filename: string;
            chatModel?: unknown;
            graphStore?: unknown;
            scope?: unknown;
            schema?: Record<string, unknown>;
        },
    ): Promise<OrchidChunk[]>;
}
