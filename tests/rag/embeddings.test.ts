import { describe, it, expect } from "vitest";
import {
    KNOWN_DIMS,
    getEmbeddingDimension,
    getEmbeddingBatchSize,
    BatchLimitingEmbeddings,
} from "../../src/rag/embeddings.js";

describe("RAG Embeddings", () => {
    describe("KNOWN_DIMS", () => {
        it("contains well-known model dimensions", () => {
            expect(KNOWN_DIMS).toHaveProperty("text-embedding-3-small", 1536);
            expect(KNOWN_DIMS).toHaveProperty("text-embedding-3-large", 3072);
            expect(KNOWN_DIMS).toHaveProperty("text-embedding-ada-002", 1536);
            expect(KNOWN_DIMS).toHaveProperty("ollama/nomic-embed-text", 768);
            expect(KNOWN_DIMS).toHaveProperty("gemini/gemini-embedding-001", 3072);
        });

        it("has correct dimensions for OpenAI models", () => {
            expect(KNOWN_DIMS["text-embedding-3-small"]).toBe(1536);
            expect(KNOWN_DIMS["text-embedding-3-large"]).toBe(3072);
        });
    });

    describe("getEmbeddingDimension", () => {
        it("returns known dimension for registered model", () => {
            expect(getEmbeddingDimension("text-embedding-3-small")).toBe(1536);
            expect(getEmbeddingDimension("ollama/nomic-embed-text")).toBe(768);
        });

        it("falls back to 1536 for unknown model", () => {
            expect(getEmbeddingDimension("unknown/model")).toBe(1536);
        });
    });

    describe("getEmbeddingBatchSize", () => {
        it("returns batch limit for gemini models", () => {
            expect(getEmbeddingBatchSize("gemini/gemini-embedding-001")).toBe(80);
        });

        it("returns batch limit for google models", () => {
            expect(getEmbeddingBatchSize("google/my-model")).toBe(80);
        });

        it("returns batch limit for cohere models", () => {
            expect(getEmbeddingBatchSize("cohere/embed-v3")).toBe(80);
        });

        it("returns batch limit for OpenAI text-embedding models", () => {
            expect(getEmbeddingBatchSize("text-embedding-3-small")).toBe(2000);
            expect(getEmbeddingBatchSize("text-embedding-ada-002")).toBe(2000);
        });

        it("returns default 32 for unknown models", () => {
            expect(getEmbeddingBatchSize("unknown/model")).toBe(32);
        });
    });

    describe("BatchLimitingEmbeddings", () => {
        it("throws on batchSize < 1", () => {
            expect(() => {
                new BatchLimitingEmbeddings({} as any, 0);
            }).toThrow("batchSize must be >= 1");
        });

        it("delegates embedQuery to inner", async () => {
            const inner = {
                embedQuery: async () => [1, 2, 3],
                embedDocuments: async (_texts: string[]) => [[1]],
            };

            const wrapper = new BatchLimitingEmbeddings(inner, 2);
            const result = await wrapper.embedQuery("hello");
            expect(result).toEqual([1, 2, 3]);
        });

        it("delegates directly when texts <= batchSize", async () => {
            const inner = {
                embedDocuments: async (texts: string[]) => texts.map(() => [0.5]),
                embedQuery: async () => [],
            };

            const wrapper = new BatchLimitingEmbeddings(inner, 5);
            const result = await wrapper.embedDocuments(["a", "b"]);
            expect(result).toEqual([[0.5], [0.5]]);
        });

        it("batches when texts exceed batchSize", async () => {
            const callLog: string[][] = [];
            const inner = {
                embedDocuments: async (texts: string[]) => {
                    callLog.push(texts);
                    return texts.map(() => [1]);
                },
                embedQuery: async () => [],
            };

            const wrapper = new BatchLimitingEmbeddings(inner, 2);
            const result = await wrapper.embedDocuments(["a", "b", "c", "d", "e"]);

            expect(callLog).toHaveLength(3);
            expect(callLog[0]).toEqual(["a", "b"]);
            expect(callLog[1]).toEqual(["c", "d"]);
            expect(callLog[2]).toEqual(["e"]);
            expect(result).toEqual([[1], [1], [1], [1], [1]]);
        });
    });
});
