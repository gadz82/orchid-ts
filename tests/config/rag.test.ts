import { describe, it, expect } from "vitest";
import {
    OrchidRAGConfigSchema,
    OrchidRetrievalConfigSchema,
    OrchidIngestionConfigSchema,
    OrchidRAGDefaultsConfigSchema,
    OrchidHydeConfigSchema,
    OrchidHybridConfigSchema,
} from "../../src/config/schema/index.js";

describe("Config Schema - RAG", () => {
    it("parses default RAG config", () => {
        const result = OrchidRAGConfigSchema.parse({});
        expect(result.k).toBe(5);
        expect(result.enabled).toBe(true);
        expect(result.ragTtl).toBe(0);
        expect(result.maxContextChars).toBeNull();
        expect(result.namespace).toBe("");
    });

    it("parses custom RAG config", () => {
        const result = OrchidRAGConfigSchema.parse({
            namespace: "acme_kb",
            k: 10,
            enabled: false,
            ragTtl: 3600,
            maxContextChars: 5000,
        });
        expect(result.namespace).toBe("acme_kb");
        expect(result.k).toBe(10);
        expect(result.enabled).toBe(false);
        expect(result.ragTtl).toBe(3600);
        expect(result.maxContextChars).toBe(5000);
    });

    it("parses ingestion config", () => {
        const result = OrchidIngestionConfigSchema.parse({
            strategy: "recursive",
            chunkSize: 2000,
            chunkOverlap: 400,
        });
        expect(result.strategy).toBe("recursive");
        expect(result.chunkSize).toBe(2000);
        expect(result.chunkOverlap).toBe(400);
    });

    it("parses retrieval config with strategy", () => {
        const result = OrchidRetrievalConfigSchema.parse({
            strategy: "hyde",
            queryTransformers: ["reformulate"],
            metadataFilters: { category: "docs" },
        });
        expect(result.strategy).toBe("hyde");
        expect(result.queryTransformers).toEqual(["reformulate"]);
    });

    it("parses HyDE config", () => {
        const result = OrchidHydeConfigSchema.parse({ nHypothetical: 3 });
        expect(result.nHypothetical).toBe(3);
    });

    it("parses hybrid config", () => {
        const result = OrchidHybridConfigSchema.parse({
            sparseEncoder: "splade",
            fusion: "linear",
            sparseWeight: 0.7,
        });
        expect(result.sparseEncoder).toBe("splade");
        expect(result.fusion).toBe("linear");
        expect(result.sparseWeight).toBe(0.7);
    });

    it("parses RAG defaults config", () => {
        const result = OrchidRAGDefaultsConfigSchema.parse({});
        expect(result.k).toBe(5);
        expect(result.enabled).toBe(true);
        expect(result.maxContextChars).toBe(3000);
    });
});
