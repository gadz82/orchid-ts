import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    SimpleRetrieval,
    RETRIEVAL_REGISTRY,
    registerRetrievalStrategy,
    getRetrievalStrategy,
} from "../../src/rag/strategies/index.js";
import { OrchidRetrievalStrategy } from "../../src/core/retrieval.js";
import type { OrchidQueryTransformer } from "../../src/core/retrieval.js";
import { makeScope } from "../../src/rag/scopes.js";
import type { OrchidVectorReader, OrchidSearchResult } from "../../src/core/repository.js";

function makeReader(returnResults: OrchidSearchResult[] = []): OrchidVectorReader {
    return {
        retrieve: vi.fn().mockResolvedValue(returnResults),
        retrieveSparse: vi.fn().mockResolvedValue([]),
        lookupCachedToolResults: vi.fn().mockResolvedValue(null),
    } as unknown as OrchidVectorReader;
}

describe("SimpleRetrieval", () => {
    let strategy: SimpleRetrieval;
    let scope: ReturnType<typeof makeScope>;

    beforeEach(() => {
        strategy = new SimpleRetrieval();
        scope = makeScope({ tenantId: "t1", userId: "u1" });
    });

    it('has name "simple"', () => {
        expect(strategy.name).toBe("simple");
    });

    it("delegates to reader.retrieve with defaults", async () => {
        const reader = makeReader([{ document: { pageContent: "doc", metadata: {} }, score: 0.9 }]);
        const results = await strategy.retrieve("query", scope, reader, "ns");

        expect(reader.retrieve).toHaveBeenCalledWith("query", "ns", 5, scope, null);
        expect(results).toHaveLength(1);
    });

    it("respects custom k parameter", async () => {
        const reader = makeReader();
        await strategy.retrieve("q", scope, reader, "ns", 10);

        expect(reader.retrieve).toHaveBeenCalledWith("q", "ns", 10, scope, null);
    });

    it("passes metadata_filters from options", async () => {
        const reader = makeReader();
        const filters = { source: "web" };

        await strategy.retrieve("q", scope, reader, "ns", 3, { metadata_filters: filters });
        expect(reader.retrieve).toHaveBeenCalledWith("q", "ns", 3, scope, filters);
    });

    it("ignores non-pre_strategy transformers but logs a warning", async () => {
        const reader = makeReader();
        const transformer: OrchidQueryTransformer = {
            name: "multi_query",
            preStrategy: false,
            transform: vi.fn().mockResolvedValue(["query1", "query2"]),
        };

        const results = await strategy.retrieve("q", scope, reader, "ns", 5, {
            transformers: [transformer],
        });
        expect(results).toEqual([]);
        expect(transformer.transform).not.toHaveBeenCalled();
        // Reader is still called with the original query
        expect(reader.retrieve).toHaveBeenCalledWith("q", "ns", 5, scope, null);
    });
});

describe("Retrieval Strategy Registry", () => {
    beforeEach(() => {
        for (const key of Object.keys(RETRIEVAL_REGISTRY)) {
            if (!["simple", "multi_query", "hyde", "hybrid", "graph_rag"].includes(key)) {
                delete RETRIEVAL_REGISTRY[key];
            }
        }
    });

    it("returns SimpleRetrieval for unknown strategy name (fallback)", () => {
        const strategy = getRetrievalStrategy("nonexistent");
        expect(strategy).toBeInstanceOf(SimpleRetrieval);
    });

    it("returns built-in strategies by name", () => {
        const simple = getRetrievalStrategy("simple");
        expect(simple).toBeInstanceOf(SimpleRetrieval);
        expect(simple.name).toBe("simple");

        const multi = getRetrievalStrategy("multi_query");
        expect(multi).toBeInstanceOf(OrchidRetrievalStrategy);
        expect(multi.name).toBe("multi_query");
    });

    it("registers and retrieves a custom strategy", () => {
        class CustomStrategy extends OrchidRetrievalStrategy {
            override get name() {
                return "custom";
            }
            override async retrieve() {
                return [];
            }
        }

        registerRetrievalStrategy("custom", CustomStrategy);
        const strategy = getRetrievalStrategy("custom");
        expect(strategy).toBeInstanceOf(CustomStrategy);
        expect(strategy.name).toBe("custom");
    });

    it("returns a new instance each time", () => {
        const s1 = getRetrievalStrategy("simple");
        const s2 = getRetrievalStrategy("simple");
        expect(s1).not.toBe(s2);
        expect(s1).toBeInstanceOf(SimpleRetrieval);
        expect(s2).toBeInstanceOf(SimpleRetrieval);
    });
});
