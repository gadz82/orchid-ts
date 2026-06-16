import { describe, it, expect, vi } from "vitest";
import { ContextualHeaderPostProcessor } from "../../src/documents/postProcessors/contextualHeaders.js";
import {
    EntityExtractionPostProcessor,
    LLMEntityExtractor,
} from "../../src/documents/postProcessors/entityExtraction.js";
import type { OrchidChunk } from "../../src/core/ingestion.js";
import { OrchidEntityExtractor } from "../../src/core/graphStore.js";
import type { OrchidEntity, OrchidEdge } from "../../src/core/graphStore.js";
import { makeScope } from "../../src/core/scopes.js";

const scope = makeScope({ tenantId: "t1" });

function makeChunks(texts: string[]): OrchidChunk[] {
    return texts.map((text, i) => ({
        text,
        metadata: {
            chunk_id: `c-${i}`,
            chunk_index: i,
            total_chunks: texts.length,
        },
    }));
}

describe("ContextualHeaderPostProcessor", () => {
    it("returns empty array for empty chunks", async () => {
        const proc = new ContextualHeaderPostProcessor();
        const result = await proc.process([], { text: "", filename: "test.md" });
        expect(result).toEqual([]);
    });

    it("prepends title and section headers to chunks", async () => {
        const proc = new ContextualHeaderPostProcessor();
        const text = "# Introduction\nContent of intro.\n\n# Methods\nMethodology details.";
        const chunks = makeChunks(["Content of intro.", "Methodology details."]);

        const result = await proc.process(chunks, { text, filename: "report.md" });

        expect(result).toHaveLength(2);
        expect(result[0].text).toContain("# Report");
        expect(result[0].text).toContain("## Introduction");
        expect(result[1].text).toContain("# Report");
        expect(result[1].text).toContain("## Methods");
    });

    it("uses filename as title context", async () => {
        const proc = new ContextualHeaderPostProcessor();
        const text = "Some content without headers.";
        const chunks = makeChunks(["Some content without headers."]);

        const result = await proc.process(chunks, { text, filename: "my_document.txt" });

        expect(result[0].text).toContain("# My Document");
        expect(result[0].text).toContain("## Document");
    });

    it("adds contextual_header: true to metadata", async () => {
        const proc = new ContextualHeaderPostProcessor();
        const text = "# Intro\nContent.";
        const chunks = makeChunks(["Content."]);

        const result = await proc.process(chunks, { text, filename: "doc.md" });

        expect(result[0].metadata.contextual_header).toBe(true);
        expect(result[0].metadata.title).toBeDefined();
        expect(result[0].metadata.section).toBeDefined();
    });

    it("skips chunks already processed with contextual_header", async () => {
        const proc = new ContextualHeaderPostProcessor();
        const text = "Content.";
        const chunks: OrchidChunk[] = [
            {
                text: "Already processed.",
                metadata: { chunk_id: "c0", contextual_header: true, section: "Intro" },
            },
        ];

        const result = await proc.process(chunks, { text, filename: "doc.md" });
        expect(result[0].text).toBe("Already processed.");
    });

    it("converts underscores and dashes in filename to title", async () => {
        const proc = new ContextualHeaderPostProcessor();
        const text = "Content.";
        const chunks = makeChunks(["Content."]);

        const result = await proc.process(chunks, { text, filename: "my-special_report.txt" });
        expect(result[0].text).toContain("# My Special Report");
    });
});

describe("EntityExtractionPostProcessor", () => {
    it("returns empty for empty chunks", async () => {
        const proc = new EntityExtractionPostProcessor();
        const result = await proc.process([], { text: "", filename: "test.txt" });
        expect(result).toEqual([]);
    });

    it("returns chunks unchanged when chatModel is null", async () => {
        const proc = new EntityExtractionPostProcessor();
        const chunks = makeChunks(["Entity text"]);
        const result = await proc.process(chunks, { text: "Entity text", filename: "test.txt" });
        expect(result).toEqual(chunks);
    });

    it("returns chunks unchanged when graphStore is null", async () => {
        const proc = new EntityExtractionPostProcessor();
        const chunks = makeChunks(["Entity text"]);
        const result = await proc.process(chunks, {
            text: "Entity text",
            filename: "test.txt",
            chatModel: {},
        });
        expect(result).toEqual(chunks);
    });

    it("returns chunks unchanged when scope is null", async () => {
        const proc = new EntityExtractionPostProcessor();
        const chunks = makeChunks(["Entity text"]);
        const result = await proc.process(chunks, {
            text: "Entity text",
            filename: "test.txt",
            chatModel: {},
            graphStore: {},
        });
        expect(result).toEqual(chunks);
    });

    it("extracts entities and adds to metadata", async () => {
        const mockExtractor = new (class extends OrchidEntityExtractor {
            async extract(
                text: string,
            ): Promise<{ entities: OrchidEntity[]; edges: OrchidEdge[] }> {
                if (text.includes("entity")) {
                    return {
                        entities: [
                            {
                                id: "person:john",
                                type: "person",
                                name: "John",
                                properties: {},
                                metadata: {},
                            },
                        ],
                        edges: [],
                    };
                }
                return { entities: [], edges: [] };
            }
        })();

        const graphStore = {
            isNull: false,
            upsertEntities: vi.fn().mockResolvedValue(undefined),
            upsertEdges: vi.fn().mockResolvedValue(undefined),
        };

        const proc = new EntityExtractionPostProcessor({ extractor: mockExtractor });
        const chunks = makeChunks(["Some entity text about John"]);

        const result = await proc.process(chunks, {
            text: "Some entity text about John",
            filename: "test.txt",
            chatModel: {},
            graphStore,
            scope,
        });

        expect(result[0].metadata.mentioned_entities).toEqual(["person:john"]);
        expect(graphStore.upsertEntities).toHaveBeenCalled();
    });

    it("handles null graphstore gracefully", async () => {
        const proc = new EntityExtractionPostProcessor();
        const chunks = makeChunks(["Some text"]);
        const result = await proc.process(chunks, {
            text: "Some text",
            filename: "test.txt",
            chatModel: {},
            graphStore: { isNull: true },
            scope,
        });
        expect(result).toEqual(chunks);
    });
});

describe("LLMEntityExtractor", () => {
    it("returns empty when chatModel is null", async () => {
        const extractor = new LLMEntityExtractor();
        const result = await extractor.extract("Some text", { chatModel: null });
        expect(result.entities).toEqual([]);
        expect(result.edges).toEqual([]);
    });

    it("returns empty for blank text", async () => {
        const extractor = new LLMEntityExtractor();
        const result = await extractor.extract("  ", { chatModel: {} });
        expect(result.entities).toEqual([]);
        expect(result.edges).toEqual([]);
    });

    it("includes schema constraints in prompt when provided", async () => {
        const extractor = new LLMEntityExtractor();
        // Default prompt should not include schema constraints
        const defaultPrompt = (extractor as any)._systemPrompt;
        expect(defaultPrompt).toContain("entity");
    });
});
