import { describe, it, expect, vi, beforeEach } from "vitest";
import { injectToRag } from "../../src/rag/dynamic.js";
import { makeScope } from "../../src/rag/scopes.js";
import type { OrchidVectorWriter } from "../../src/core/repository.js";
import type { OrchidIngestionStrategy, OrchidChunk } from "../../src/core/ingestion.js";
import type { OrchidRAGScope } from "../../src/core/scopes.js";

function makeWriter(): OrchidVectorWriter {
    return {
        index: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    };
}

function makeIngestion(chunks: OrchidChunk[] = []): OrchidIngestionStrategy {
    return {
        ingest: vi.fn().mockResolvedValue(chunks),
    } as unknown as OrchidIngestionStrategy;
}

describe("injectToRag", () => {
    let scope: OrchidRAGScope;

    beforeEach(() => {
        scope = makeScope({ tenantId: "t1", userId: "u1", chatId: "c1" });
    });

    it("skips when store has no index method", async () => {
        const reader = {
            retrieve: async () => [],
        };

        const count = await injectToRag(reader as any, {
            toolName: "test_tool",
            toolResult: "some result",
            namespace: "ns",
            scope,
            ingestion: makeIngestion(),
        });

        expect(count).toBe(0);
    });

    it("skips when toolResult is an error object", async () => {
        const writer = makeWriter();
        const count = await injectToRag(writer, {
            toolName: "test_tool",
            toolResult: { error: "something went wrong" },
            namespace: "ns",
            scope,
            ingestion: makeIngestion(),
        });

        expect(count).toBe(0);
        expect(writer.upsert).not.toHaveBeenCalled();
    });

    it("skips when toolResult is empty string", async () => {
        const writer = makeWriter();
        const count = await injectToRag(writer, {
            toolName: "test_tool",
            toolResult: "   ",
            namespace: "ns",
            scope,
            ingestion: makeIngestion(),
        });

        expect(count).toBe(0);
    });

    it("skips when ingestion produces no chunks", async () => {
        const writer = makeWriter();
        const ingestion = makeIngestion([]);

        const count = await injectToRag(writer, {
            toolName: "test_tool",
            toolResult: "valid result",
            namespace: "ns",
            scope,
            ingestion,
        });

        expect(count).toBe(0);
        expect(writer.upsert).not.toHaveBeenCalled();
    });

    it("injects chunks into the writer", async () => {
        const writer = makeWriter();
        const chunks: OrchidChunk[] = [
            { text: "chunk 1", metadata: { idx: 0 } },
            { text: "chunk 2", metadata: { idx: 1 } },
        ];
        const ingestion = makeIngestion(chunks);

        const count = await injectToRag(writer, {
            toolName: "my_tool",
            toolResult: { data: "important info" },
            namespace: "my_ns",
            scope,
            ingestion,
        });

        expect(count).toBe(2);
        expect(writer.upsert).toHaveBeenCalledOnce();
        const [docs, ns] = (writer.upsert as any).mock.calls[0];
        expect(ns).toBe("my_ns");
        expect(docs).toHaveLength(2);
        expect(docs[0].pageContent).toBe("chunk 1");
        expect(docs[0].metadata).toHaveProperty("source_tool", "my_tool");
        expect(docs[0].metadata).toHaveProperty("dynamic", true);
        expect(docs[0].metadata).toHaveProperty("injected_at");
        expect(docs[1].pageContent).toBe("chunk 2");
    });

    it("handles array tool results", async () => {
        const writer = makeWriter();
        const chunks: OrchidChunk[] = [{ text: "array result", metadata: {} }];
        const ingestion = makeIngestion(chunks);

        const count = await injectToRag(writer, {
            toolName: "list_tool",
            toolResult: ["item1", "item2"],
            namespace: "ns",
            scope,
            ingestion,
        });

        expect(count).toBe(1);
        expect(writer.upsert).toHaveBeenCalledOnce();
    });

    it("returns 0 on writer upsert failure", async () => {
        const writer = makeWriter();
        writer.upsert = vi.fn().mockRejectedValue(new Error("upsert failed"));
        const chunks: OrchidChunk[] = [{ text: "data", metadata: {} }];
        const ingestion = makeIngestion(chunks);

        const count = await injectToRag(writer, {
            toolName: "failing_tool",
            toolResult: "data",
            namespace: "ns",
            scope,
            ingestion,
        });

        expect(count).toBe(0);
    });

    it("handles null/undefined toolResult", async () => {
        const writer = makeWriter();
        const count = await injectToRag(writer, {
            toolName: "t",
            toolResult: null,
            namespace: "ns",
            scope,
            ingestion: makeIngestion(),
        });

        expect(count).toBe(0);
    });
});
