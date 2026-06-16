import { describe, it, expect, beforeEach } from "vitest";
import {
    VECTOR_BACKEND_REGISTRY,
    buildReader,
    registerVectorBackend,
} from "../../src/rag/factory.js";
import { NullVectorReader } from "../../src/rag/backends/null.js";
import { OrchidVectorReader } from "../../src/core/repository.js";
import type { OrchidSearchResult, OrchidMetadataFilters } from "../../src/core/repository.js";
import type { OrchidRAGScope } from "../../src/core/scopes.js";

describe("RAG Factory", () => {
    beforeEach(() => {
        for (const key of Object.keys(VECTOR_BACKEND_REGISTRY)) {
            if (key !== "null") {
                delete VECTOR_BACKEND_REGISTRY[key];
            }
        }
    });

    describe("buildReader", () => {
        it("returns NullVectorReader when no vector_backend is specified", () => {
            const reader = buildReader();
            expect(reader).toBeInstanceOf(NullVectorReader);
        });

        it('returns NullVectorReader for explicit "null" backend', () => {
            const reader = buildReader({ vectorBackend: "null" });
            expect(reader).toBeInstanceOf(NullVectorReader);
        });

        it("builds a custom registered vector backend", () => {
            class MockReader extends OrchidVectorReader {
                override async retrieve(
                    _query: string,
                    _namespace: string,
                    _k?: number,
                    _scope?: OrchidRAGScope | null,
                    _metadataFilters?: OrchidMetadataFilters | null,
                ): Promise<OrchidSearchResult[]> {
                    return [{ document: { pageContent: "mock", metadata: {} }, score: 1 }];
                }
            }

            registerVectorBackend("mock", (opts) => new MockReader());
            const reader = buildReader({ vectorBackend: "mock" });
            expect(reader).toBeInstanceOf(MockReader);
            expect(reader).not.toBeInstanceOf(NullVectorReader);
        });

        it("throws for unknown vector backend", () => {
            expect(() => buildReader({ vectorBackend: "nonexistent_backend" })).toThrow(
                /Unknown vector backend/,
            );
        });

        it("passes extra options to the builder", () => {
            let receivedOpts: Record<string, unknown> = {};
            class ConfigReader extends OrchidVectorReader {
                override async retrieve(): Promise<OrchidSearchResult[]> {
                    return [];
                }
            }

            registerVectorBackend("configurable", (opts) => {
                receivedOpts = opts as Record<string, unknown>;
                return new ConfigReader();
            });

            buildReader({
                vectorBackend: "configurable",
                customOption: "value",
                another: 42,
            });

            expect(receivedOpts).toHaveProperty("customOption", "value");
            expect(receivedOpts).toHaveProperty("another", 42);
        });
    });

    describe("registerVectorBackend", () => {
        it("registers a new backend builder", () => {
            class NewReader extends OrchidVectorReader {
                override async retrieve(): Promise<OrchidSearchResult[]> {
                    return [];
                }
            }

            registerVectorBackend("new_backend", () => new NewReader());
            expect(VECTOR_BACKEND_REGISTRY).toHaveProperty("new_backend");

            const reader = buildReader({ vectorBackend: "new_backend" });
            expect(reader).toBeInstanceOf(NewReader);
        });
    });

    describe("NullVectorReader", () => {
        it("retrieve returns empty array", async () => {
            const reader = buildReader();
            const results = await reader.retrieve("query", "namespace");
            expect(results).toEqual([]);
        });

        it("retrieveSparse returns empty array", async () => {
            const reader = buildReader();
            const results = await reader.retrieveSparse({ indices: new Map(), magnitude: 0 }, "ns");
            expect(results).toEqual([]);
        });

        it("lookupCachedToolResults returns null", async () => {
            const reader = buildReader();
            const result = await reader.lookupCachedToolResults(
                "ns",
                {} as OrchidRAGScope,
                "tool",
                0,
            );
            expect(result).toBeNull();
        });
    });
});
