import { createHash } from "node:crypto";
import type { OrchidDocument, OrchidVectorReader, OrchidVectorWriter } from "../core/repository.js";
import type { OrchidRAGScope } from "../core/scopes.js";
import type { OrchidIngestionStrategy } from "../core/ingestion.js";

function sha256Digest(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function serialise(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export async function injectToRag(
    store: OrchidVectorReader | OrchidVectorWriter,
    opts: {
        toolName: string;
        toolResult: unknown;
        namespace: string;
        scope: OrchidRAGScope;
        ingestion: OrchidIngestionStrategy;
    },
): Promise<number> {
    const { toolName, toolResult, namespace, scope, ingestion } = opts;

    if (!(store as any)["index"]) {
        console.error(
            "[DynamicRAG] Store does not support writing — skipping injection of '%s'",
            toolName,
        );
        return 0;
    }

    if (
        toolResult &&
        typeof toolResult === "object" &&
        !Array.isArray(toolResult) &&
        "error" in toolResult
    ) {
        return 0;
    }

    const text = serialise(toolResult);
    if (!text.trim()) return 0;

    const chunks = await ingestion.ingest({
        text,
        filename: toolName,
        scope,
    });
    if (!chunks.length) return 0;

    const documents: OrchidDocument[] = [];
    for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const contentHash = sha256Digest(chunk.text);
        const docId =
            (chunk.metadata["chunk_id"] as string | undefined) ??
            `dynamic-${toolName}-${scope.tenantId}-${scope.chatId}-${idx}-${contentHash}`;
        documents.push({
            id: docId,
            pageContent: chunk.text,
            metadata: {
                ...chunk.metadata,
                source_tool: toolName,
                dynamic: true,
                injected_at: Date.now() / 1000,
            },
        });
    }

    const writer = store as OrchidVectorWriter;
    try {
        await writer.upsert(documents, namespace);
    } catch (err) {
        console.warn("[DynamicRAG] Failed to inject '%s' into '%s': %s", toolName, namespace, err);
        return 0;
    }

    console.error(
        "[DynamicRAG] Injected %d chunks from '%s' into '%s' (tenant=%s, chat=%s)",
        documents.length,
        toolName,
        namespace,
        scope.tenantId,
        scope.chatId,
    );
    return documents.length;
}
