/** HierarchicalIngestion — separate parent docstore for true hierarchical RAG. */

import { createHash } from "node:crypto";
import type { OrchidRAGScope } from "../../core/scopes.js";
import type { OrchidDocStore } from "../../core/docStore.js";
import { OrchidIngestionStrategy } from "../../core/ingestion.js";
import type { OrchidChunk } from "../../core/ingestion.js";
import type { ChunkConfig } from "../chunker.js";
import { parentChildChunkText } from "../chunker.js";

const DEFAULT_CONFIG: Required<ChunkConfig> = {
    chunkSize: 1000,
    chunkOverlap: 200,
    separator: "\n\n",
    parentChunkSize: 0,
    parentChunkOverlap: 200,
};

export class HierarchicalIngestion extends OrchidIngestionStrategy {
    private _config: Required<ChunkConfig>;

    constructor(config?: ChunkConfig) {
        super();
        this._config = config ? { ...DEFAULT_CONFIG, ...config } : { ...DEFAULT_CONFIG };
    }

    async ingest(opts: {
        text: string;
        filename: string;
        scope: OrchidRAGScope;
        docStore?: OrchidDocStore | null;
        embeddings?: unknown;
    }): Promise<OrchidChunk[]> {
        const { text, filename, scope, docStore } = opts;
        if (!text.trim()) return [];

        const cfg = this._config;
        const parentSize = cfg.parentChunkSize || Math.max(cfg.chunkSize * 4, cfg.chunkSize + 200);

        const fileHash = createHash("sha256").update(text).digest("hex").slice(0, 12);

        const useMetadataFallback = !docStore || (docStore as any).isNull === true;

        const pcChunks = parentChildChunkText(text, {
            ...cfg,
            parentChunkSize: parentSize,
        });

        if (pcChunks.length === 0) return [];

        // Group children by parent index for docstore writes
        const parentMap = new Map<number, { parentText: string; children: typeof pcChunks }>();
        for (const pc of pcChunks) {
            if (!parentMap.has(pc.parentIndex)) {
                parentMap.set(pc.parentIndex, { parentText: pc.parentText, children: [] });
            }
            parentMap.get(pc.parentIndex)!.children.push(pc);
        }

        const out: OrchidChunk[] = [];

        for (const [pi, group] of parentMap) {
            const parentId = `parent-${fileHash}-${pi}`;

            // Write parent to docstore if available
            if (docStore) {
                await docStore.put({
                    id: parentId,
                    pageContent: group.parentText,
                    metadata: {
                        tenant_id: scope.tenantId,
                        user_id: scope.userId,
                        chat_id: scope.chatId,
                        scope: "chat_shared",
                        source_file: filename,
                        parent_index: pi,
                    },
                });
            }

            for (let ci = 0; ci < group.children.length; ci++) {
                const child = group.children[ci];
                const metadata: Record<string, unknown> = {
                    tenant_id: scope.tenantId,
                    user_id: scope.userId,
                    chat_id: scope.chatId,
                    scope: "chat_shared",
                    source_file: filename,
                    parent_id: parentId,
                    parent_index: pi,
                    chunk_id: `${parentId}-c${ci}`,
                    chunk_index: ci,
                    ingestion_strategy: "hierarchical",
                };

                if (useMetadataFallback) {
                    metadata.parent_content = child.parentText;
                }

                out.push({ text: child.childText, metadata });
            }
        }

        return out;
    }
}
