/**
 * RAG-augmented conversation memory.
 *
 * Extends the in-memory running summary with Qdrant-backed semantic
 * retrieval of past conversation turns. Uses three strategies in
 * combination:
 *
 * 1. Running summary (inherited) for broad conversation context.
 * 2. Recent verbatim turns for immediate context.
 * 3. RAG-retrieved turns for semantically relevant context from any
 *    point in the conversation history.
 *
 * Qdrant interactions go through ``OrchidVectorReader`` /
 * ``OrchidVectorWriter`` interfaces — no concrete backend imports.
 */
import { createHash } from "node:crypto";
import type { OrchidVectorReader, OrchidVectorWriter, ChatModelLike } from "../core/index.js";
import { makeScope } from "../core/scopes.js";
import type { OrchidRAGScope } from "../core/scopes.js";
import type { OrchidDocument } from "../core/repository.js";
import { OrchidInMemoryConversationMemory } from "./memory.js";

const MEMORY_NAMESPACE = "__memory__";

function sha256(text: string): string {
    return createHash("sha256").update(text, "utf-8").digest("hex");
}

export class OrchidRAGConversationMemory extends OrchidInMemoryConversationMemory {
    private reader: OrchidVectorReader;
    private writer: OrchidVectorWriter;

    constructor(
        chatStorage: {
            getConversationSummary(chatId: string): Promise<string | null>;
            saveConversationSummary(
                chatId: string,
                summary: string,
                turnNumber: number,
            ): Promise<void>;
        },
        chatModel: ChatModelLike,
        reader: OrchidVectorReader,
        writer: OrchidVectorWriter,
        opts: { structuredOutput?: boolean } = {},
    ) {
        super(chatStorage, chatModel, opts);
        this.reader = reader;
        this.writer = writer;
    }

    async storeConversationTurn(
        chatId: string,
        tenantId: string,
        userId: string,
        turn: Record<string, string>,
        metadata?: Record<string, unknown> | null,
    ): Promise<void> {
        const content = turn["content"] ?? "";
        if (!content.trim()) return;

        const contentHash = sha256(content).slice(0, 16);
        const docId = `mem-${chatId}-${Date.now()}-${contentHash}`;

        const docMetadata: Record<string, unknown> = {
            tenant_id: tenantId,
            user_id: userId,
            chat_id: chatId,
            scope: "chat_shared",
            source: "conversation_memory",
            turn_role: turn["role"] ?? "",
            ...(metadata ?? {}),
        };

        const doc: OrchidDocument = {
            id: docId,
            pageContent: content,
            metadata: docMetadata,
        };

        try {
            await this.writer.upsert([doc], MEMORY_NAMESPACE);
        } catch (exc: unknown) {
            console.warn("[RAGMemory] Failed to store turn for chat %s: %s", chatId, exc);
        }
    }

    async getRelevantHistory(
        query: string,
        chatId: string,
        k = 5,
        rest?: {
            tenantId?: string;
            userId?: string;
            similarityThreshold?: number;
        },
    ): Promise<Array<Record<string, unknown>>> {
        const tenantId = rest?.tenantId ?? "default";
        const userId = rest?.userId ?? "";
        const similarityThreshold = rest?.similarityThreshold ?? 0.5;

        const scope: OrchidRAGScope = makeScope({
            tenantId,
            userId,
            chatId,
            agentId: "",
        });

        let results;
        try {
            results = await this.reader.retrieve(query, MEMORY_NAMESPACE, k, scope);
        } catch {
            console.warn(
                "[RAGMemory] Retrieval failed for chat %s (namespace=%s), returning empty",
                chatId,
                MEMORY_NAMESPACE,
            );
            return [];
        }

        const relevant: Array<Record<string, unknown>> = [];
        for (const r of results) {
            if (r.score < similarityThreshold) continue;
            relevant.push({
                role: "assistant",
                content: r.document.pageContent,
                score: r.score,
            });
        }
        return relevant;
    }

    async getRelevantHistoryMerged(
        query: string,
        chatId: string,
        recentVerbatim: Array<Record<string, unknown>>,
        opts?: {
            tenantId?: string;
            userId?: string;
            k?: number;
            similarityThreshold?: number;
        },
    ): Promise<Array<Record<string, unknown>>> {
        const ragTurns = await this.getRelevantHistory(query, chatId, opts?.k, {
            tenantId: opts?.tenantId,
            userId: opts?.userId,
            similarityThreshold: opts?.similarityThreshold,
        });

        if (ragTurns.length === 0) {
            return [...recentVerbatim];
        }

        const verbatimHashes = new Set<string>();
        for (const m of recentVerbatim) {
            verbatimHashes.add(sha256(String(m["content"] ?? "")));
        }

        const deduped: Array<Record<string, unknown>> = [];
        for (const t of ragTurns) {
            const content = String(t["content"] ?? "");
            const ch = sha256(content);
            if (!verbatimHashes.has(ch)) {
                deduped.push({
                    role: String(t["role"] ?? "assistant"),
                    content,
                });
            }
        }

        return [...deduped, ...recentVerbatim];
    }
}
