/** SemanticIngestion — embedding-driven boundary detection. */

import { createHash } from "node:crypto";
import type { OrchidRAGScope } from "../../core/scopes.js";
import { OrchidIngestionStrategy } from "../../core/ingestion.js";
import type { OrchidChunk } from "../../core/ingestion.js";
import { RecursiveIngestion } from "./recursive.js";

const _SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z])|\n\n+/g;

function _splitSentences(text: string): string[] {
    const parts = text.trim().split(_SENTENCE_BOUNDARY);
    return parts.map((p) => p.trim()).filter(Boolean);
}

function _cosine(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function _percentile(values: number[], pct: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const k = (sorted.length - 1) * (pct / 100);
    const f = Math.floor(k);
    const c = Math.ceil(k);
    if (f === c) return sorted[f];
    return sorted[f] * (c - k) + sorted[c] * (k - f);
}

export class SemanticIngestion extends OrchidIngestionStrategy {
    private _breakpointPercentile: number;
    private _minChunkChars: number;
    private _fallbackChunkSize: number;

    constructor(opts?: {
        breakpointPercentile?: number;
        minChunkChars?: number;
        fallbackChunkSize?: number;
    }) {
        super();
        this._breakpointPercentile = opts?.breakpointPercentile ?? 5.0;
        this._minChunkChars = opts?.minChunkChars ?? 500;
        this._fallbackChunkSize = opts?.fallbackChunkSize ?? 1000;

        if (this._breakpointPercentile <= 0 || this._breakpointPercentile >= 100) {
            throw new Error(
                `breakpointPercentile must be in (0, 100); got ${this._breakpointPercentile}`,
            );
        }
    }

    async ingest(opts: {
        text: string;
        filename: string;
        scope: OrchidRAGScope;
        docStore?: unknown;
        embeddings?: any;
    }): Promise<OrchidChunk[]> {
        const { text, filename, scope, embeddings } = opts;
        if (!text.trim()) return [];

        if (!embeddings) {
            return this._fallback().ingest({ text, filename, scope });
        }

        if (text.length < this._minChunkChars) {
            return this._fallback().ingest({ text, filename, scope });
        }

        const sentences = _splitSentences(text);
        if (sentences.length < 2) {
            return this._fallback().ingest({ text, filename, scope });
        }

        let sentenceVectors: number[][];
        try {
            sentenceVectors = await embeddings.embedDocuments(sentences);
        } catch {
            return this._fallback().ingest({ text, filename, scope });
        }

        // Compute consecutive cosine similarities
        const similarities: number[] = [];
        for (let i = 0; i < sentenceVectors.length - 1; i++) {
            similarities.push(_cosine(sentenceVectors[i], sentenceVectors[i + 1]));
        }

        const threshold = _percentile(similarities, this._breakpointPercentile);

        // Group sentences by similarity breakpoints
        const groups: string[][] = [[sentences[0]]];
        for (let i = 0; i < similarities.length; i++) {
            if (similarities[i] <= threshold) {
                groups.push([sentences[i + 1]]);
            } else {
                groups[groups.length - 1].push(sentences[i + 1]);
            }
        }

        return this._groupsToChunks(groups, text, filename, scope);
    }

    private _fallback(): RecursiveIngestion {
        return new RecursiveIngestion({ chunkSize: this._fallbackChunkSize });
    }

    private _groupsToChunks(
        groups: string[][],
        text: string,
        filename: string,
        scope: OrchidRAGScope,
    ): OrchidChunk[] {
        const fileHash = createHash("sha256").update(text).digest("hex").slice(0, 12);
        const out: OrchidChunk[] = [];
        for (let i = 0; i < groups.length; i++) {
            const chunkText = groups[i].join(" ").trim();
            if (!chunkText) continue;
            out.push({
                text: chunkText,
                metadata: {
                    tenant_id: scope.tenantId,
                    user_id: scope.userId,
                    chat_id: scope.chatId,
                    scope: "chat_shared",
                    source_file: filename,
                    chunk_id: `semantic-${fileHash}-${i}`,
                    chunk_index: i,
                    total_chunks: groups.length,
                    ingestion_strategy: "semantic",
                },
            });
        }
        return out;
    }
}
