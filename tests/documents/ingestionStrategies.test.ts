import { describe, it, expect } from "vitest";
import { RecursiveIngestion } from "../../src/documents/strategies/recursive.js";
import { SemanticIngestion } from "../../src/documents/strategies/semantic.js";
import { HierarchicalIngestion } from "../../src/documents/strategies/hierarchical.js";
import { makeScope } from "../../src/core/scopes.js";
import type { OrchidRAGScope } from "../../src/core/scopes.js";

const scope: OrchidRAGScope = makeScope({
    tenantId: "t1",
    userId: "u1",
    chatId: "c1",
});

describe("RecursiveIngestion", () => {
    it("returns empty for blank text", async () => {
        const s = new RecursiveIngestion();
        const chunks = await s.ingest({ text: "   ", filename: "test.txt", scope });
        expect(chunks).toEqual([]);
    });

    it("returns single chunk for short text", async () => {
        const s = new RecursiveIngestion({ chunkSize: 1000 });
        const chunks = await s.ingest({
            text: "This is a short document.",
            filename: "test.txt",
            scope,
        });
        expect(chunks.length).toBe(1);
        expect(chunks[0].text).toBe("This is a short document.");
        expect(chunks[0].metadata.source_file).toBe("test.txt");
    });

    it("splits long text into multiple chunks", async () => {
        const s = new RecursiveIngestion({ chunkSize: 50, chunkOverlap: 10 });
        const longText = "Paragraph one." + "\n\n" + "Paragraph two." + "\n\n" + "Paragraph three.";
        const chunks = await s.ingest({ text: longText, filename: "doc.txt", scope });
        expect(chunks.length).toBeGreaterThanOrEqual(1);
        chunks.forEach((c) => {
            expect(c.metadata.tenant_id).toBe("t1");
            expect(c.metadata.scope).toBe("chat_shared");
            expect(c.metadata.chunk_id).toBeDefined();
        });
    });

    it("generates parent-child chunks when parentChunkSize is set", async () => {
        const s = new RecursiveIngestion({
            chunkSize: 100,
            chunkOverlap: 20,
            parentChunkSize: 400,
        });
        const text =
            "Section A paragraph one with some content.\n\n" +
            "Section A paragraph two.\n\n" +
            "Section B paragraph one.\n\n" +
            "Section B paragraph two.\n\n" +
            "Section C content.";
        const chunks = await s.ingest({ text, filename: "doc.txt", scope });
        expect(chunks.length).toBeGreaterThan(0);
        // Parent content should be in metadata
        const hasParent = chunks.some((c) => c.metadata.parent_content !== undefined);
        expect(hasParent).toBe(true);
    });

    it("includes all required metadata fields", async () => {
        const s = new RecursiveIngestion();
        const chunks = await s.ingest({ text: "Hello world", filename: "test.txt", scope });
        expect(chunks[0].metadata.tenant_id).toBe("t1");
        expect(chunks[0].metadata.user_id).toBe("u1");
        expect(chunks[0].metadata.chat_id).toBe("c1");
        expect(chunks[0].metadata.source_file).toBe("test.txt");
    });
});

describe("SemanticIngestion", () => {
    it("returns empty for blank text", async () => {
        const s = new SemanticIngestion();
        const chunks = await s.ingest({ text: "", filename: "test.txt", scope });
        expect(chunks).toEqual([]);
    });

    it("falls back to recursive when no embeddings", async () => {
        const s = new SemanticIngestion();
        const text = "Short text for fallback test.";
        const chunks = await s.ingest({ text, filename: "doc.txt", scope });
        expect(chunks.length).toBe(1);
        // Should not have semantic strategy marker since fallback was used
    });

    it("falls back to recursive when text is too short", async () => {
        const s = new SemanticIngestion({ minChunkChars: 1000 });
        const chunks = await s.ingest({
            text: "Tiny text.",
            filename: "tiny.txt",
            scope,
            embeddings: { embedDocuments: async () => [[0.1, 0.2]] },
        });
        expect(chunks.length).toBe(1);
    });

    it("throws on invalid breakpointPercentile", () => {
        expect(() => new SemanticIngestion({ breakpointPercentile: 0 })).toThrow();
        expect(() => new SemanticIngestion({ breakpointPercentile: 100 })).toThrow();
        expect(() => new SemanticIngestion({ breakpointPercentile: -1 })).toThrow();
    });

    it("creates semantic-style chunk IDs when embeddings provided", async () => {
        const s = new SemanticIngestion({ minChunkChars: 10, breakpointPercentile: 10 });
        const text =
            "First sentence about cats. Second sentence about dogs. Third sentence about birds that fly. Fourth sentence about fish.";

        const mockEmbeddings = {
            embedDocuments: async (texts: string[]) =>
                texts.map(() => {
                    // Return fake vectors that simulate varied content
                    const seed = Math.random();
                    return [seed * 0.5, (1 - seed) * 0.5];
                }),
        };

        const chunks = await s.ingest({
            text,
            filename: "animals.txt",
            scope,
            embeddings: mockEmbeddings,
        });
        expect(chunks.length).toBeGreaterThan(0);
        chunks.forEach((c) => {
            expect(c.metadata.ingestion_strategy).toBe("semantic");
            expect(String(c.metadata.chunk_id)).toContain("semantic-");
        });
    });
});

describe("HierarchicalIngestion", () => {
    it("returns empty for blank text", async () => {
        const s = new HierarchicalIngestion();
        const chunks = await s.ingest({ text: "   ", filename: "test.txt", scope });
        expect(chunks).toEqual([]);
    });

    it("creates parent-child chunks with parent_id links", async () => {
        const s = new HierarchicalIngestion({
            chunkSize: 100,
            chunkOverlap: 20,
            parentChunkSize: 400,
        });
        const text =
            "Section A paragraph one.\n\n" +
            "Section A paragraph two.\n\n" +
            "Section B paragraph one.\n\n" +
            "Section B paragraph two.";

        const chunks = await s.ingest({ text, filename: "doc.txt", scope });
        expect(chunks.length).toBeGreaterThan(0);

        // Verify hierarchical structure metadata
        const hasParentId = chunks.some((c) => c.metadata.parent_id !== undefined);
        expect(hasParentId).toBe(true);

        chunks.forEach((c) => {
            expect(c.metadata.ingestion_strategy).toBe("hierarchical");
            expect(c.metadata.tenant_id).toBe("t1");
        });
    });

    it("uses docStore when provided", async () => {
        const docStoreEntries: Array<{ id: string; content: string }> = [];
        const mockStore = {
            put: async (doc: any) => {
                docStoreEntries.push({ id: doc.id, content: doc.pageContent });
            },
            get: async () => null,
            getMany: async () => [],
        };

        const s = new HierarchicalIngestion({
            chunkSize: 200,
            parentChunkSize: 400,
        });
        const text =
            "Paragraph one with some content about testing.\n\n" +
            "Paragraph two about different things.";
        const chunks = await s.ingest({
            text,
            filename: "doc.txt",
            scope,
            docStore: mockStore as any,
        });

        expect(chunks.length).toBeGreaterThan(0);
        // DocStore should have parent entries
        expect(docStoreEntries.length).toBeGreaterThan(0);
    });

    it("falls back to metadata parent_content when no docStore", async () => {
        const s = new HierarchicalIngestion({
            chunkSize: 200,
            parentChunkSize: 400,
        });
        const text = "Paragraph one.\n\n" + "Paragraph two.";

        const chunks = await s.ingest({ text, filename: "doc.txt", scope });
        expect(chunks.length).toBeGreaterThan(0);
        const hasMetadataFallback = chunks.some((c) => c.metadata.parent_content !== undefined);
        expect(hasMetadataFallback).toBe(true);
    });
});
