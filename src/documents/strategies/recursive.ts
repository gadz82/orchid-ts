/** RecursiveIngestion — flat or parent-in-metadata chunking. */

import { createHash } from "node:crypto";
import type { OrchidRAGScope } from "../../core/scopes.js";
import { OrchidIngestionStrategy } from "../../core/ingestion.js";
import type { OrchidChunk } from "../../core/ingestion.js";
import type { ChunkConfig } from "../chunker.js";
import { chunkText, parentChildChunkText } from "../chunker.js";

const DEFAULT_CONFIG: Required<ChunkConfig> = {
    chunkSize: 1000,
    chunkOverlap: 200,
    separator: "\n\n",
    parentChunkSize: 0,
    parentChunkOverlap: 200,
};

export class RecursiveIngestion extends OrchidIngestionStrategy {
    private _config: Required<ChunkConfig>;

    constructor(config?: ChunkConfig) {
        super();
        this._config = config ? { ...DEFAULT_CONFIG, ...config } : { ...DEFAULT_CONFIG };
    }

    async ingest(opts: {
        text: string;
        filename: string;
        scope: OrchidRAGScope;
        docStore?: unknown;
        embeddings?: unknown;
    }): Promise<OrchidChunk[]> {
        const { text, filename, scope } = opts;
        if (!text.trim()) return [];

        const cfg = this._config;
        const fileHash = createHash("sha256").update(text).digest("hex").slice(0, 12);
        const chunks: OrchidChunk[] = [];

        if (cfg.parentChunkSize > 0) {
            const pcChunks = parentChildChunkText(text, this._config);
            for (let i = 0; i < pcChunks.length; i++) {
                const pc = pcChunks[i];
                const chunkId = `upload-${fileHash}-p${pc.parentIndex}c${pc.childIndex}`;
                chunks.push({
                    text: pc.childText,
                    metadata: {
                        tenant_id: scope.tenantId,
                        user_id: scope.userId,
                        chat_id: scope.chatId,
                        scope: "chat_shared",
                        source_file: filename,
                        chunk_id: chunkId,
                        chunk_index: i,
                        total_chunks: pcChunks.length,
                        parent_content: pc.parentText,
                        parent_index: pc.parentIndex,
                    },
                });
            }
        } else {
            const flatChunks = chunkText(text, this._config);
            for (let i = 0; i < flatChunks.length; i++) {
                const chunkId = `upload-${fileHash}-${i}`;
                chunks.push({
                    text: flatChunks[i],
                    metadata: {
                        tenant_id: scope.tenantId,
                        user_id: scope.userId,
                        chat_id: scope.chatId,
                        scope: "chat_shared",
                        source_file: filename,
                        chunk_id: chunkId,
                        chunk_index: i,
                        total_chunks: flatChunks.length,
                    },
                });
            }
        }

        return chunks;
    }
}
