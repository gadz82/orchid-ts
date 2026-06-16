import type { OrchidVectorReader } from "../core/repository.js";
import type { OrchidDocStore } from "../core/docStore.js";
import type { OrchidGraphStore } from "../core/graphStore.js";
import type { OrchidSparseEncoder } from "../core/sparse.js";

import { NullVectorReader, NullDocStore, NullGraphStore } from "./backends/null.js";
import { InMemoryDocStore } from "./backends/inMemoryDocStore.js";
import { InMemoryGraphStore } from "./backends/inMemoryGraph.js";

export type VectorBackendBuilder = (...args: any[]) => OrchidVectorReader;
export type DocStoreBackendBuilder = (...args: any[]) => OrchidDocStore;
export type GraphStoreBackendBuilder = (...args: any[]) => OrchidGraphStore;

export const VECTOR_BACKEND_REGISTRY: Record<string, VectorBackendBuilder> = {};
export const DOC_STORE_BACKEND_REGISTRY: Record<string, DocStoreBackendBuilder> = {};
export const GRAPH_STORE_BACKEND_REGISTRY: Record<string, GraphStoreBackendBuilder> = {};

const BACKEND_PACKAGE_HINTS: Record<string, string> = {
    qdrant: "orchid-rag-qdrant",
    neo4j: "orchid-rag-neo4j",
    chroma: "orchid-rag-chroma",
};

function formatMissingBackendError(name: string, backendType: string): string {
    const hint = BACKEND_PACKAGE_HINTS[name];
    const lines: string[] = [`Unknown ${backendType} backend '${name}'.`];
    if (hint) lines.push(`Install the missing plugin: npm install ${hint}`);
    lines.push(
        `Registered built-ins: ${sortedRegistryKeys(backendType)}. ` +
            `Call register${capitalize(backendType)}Backend('${name}', builder) before constructing Orchid.`,
    );
    return lines.join(" ");
}

function sortedRegistryKeys(backendType: string): string[] {
    switch (backendType) {
        case "vector":
            return Object.keys(VECTOR_BACKEND_REGISTRY).sort();
        case "docStore":
            return Object.keys(DOC_STORE_BACKEND_REGISTRY).sort();
        case "graphStore":
            return Object.keys(GRAPH_STORE_BACKEND_REGISTRY).sort();
        default:
            return [];
    }
}

function capitalize(s: string): string {
    return (
        s.charAt(0).toUpperCase() +
        s
            .slice(1)
            .replace(/([A-Z])/g, "_$1")
            .toLowerCase()
    );
}

export function registerVectorBackend(name: string, builder: VectorBackendBuilder): void {
    if (name in VECTOR_BACKEND_REGISTRY && VECTOR_BACKEND_REGISTRY[name] !== builder) {
        console.warn("[VectorBackends] '%s' already registered; overwriting", name);
    }
    VECTOR_BACKEND_REGISTRY[name] = builder;
    console.error("[VectorBackends] Registered '%s'", name);
}

export function registerDocStoreBackend(name: string, builder: DocStoreBackendBuilder): void {
    if (name in DOC_STORE_BACKEND_REGISTRY && DOC_STORE_BACKEND_REGISTRY[name] !== builder) {
        console.warn("[DocStoreBackends] '%s' already registered; overwriting", name);
    }
    DOC_STORE_BACKEND_REGISTRY[name] = builder;
    console.error("[DocStoreBackends] Registered '%s'", name);
}

export function registerGraphStoreBackend(name: string, builder: GraphStoreBackendBuilder): void {
    if (name in GRAPH_STORE_BACKEND_REGISTRY && GRAPH_STORE_BACKEND_REGISTRY[name] !== builder) {
        console.warn("[GraphStoreBackends] '%s' already registered; overwriting", name);
    }
    GRAPH_STORE_BACKEND_REGISTRY[name] = builder;
    console.error("[GraphStoreBackends] Registered '%s'", name);
}

export function buildReader(
    opts: {
        vectorBackend?: string;
        [key: string]: unknown;
    } = {},
): OrchidVectorReader {
    const name = opts.vectorBackend ?? "null";
    const builder = VECTOR_BACKEND_REGISTRY[name];
    if (!builder) throw new Error(formatMissingBackendError(name, "vector"));
    return builder(opts);
}

export function buildDocStore(
    opts: {
        docStoreBackend?: string;
        [key: string]: unknown;
    } = {},
): OrchidDocStore {
    const name = opts.docStoreBackend ?? "null";
    const builder = DOC_STORE_BACKEND_REGISTRY[name];
    if (!builder) throw new Error(formatMissingBackendError(name, "docStore"));
    return builder(opts);
}

export function buildGraphStore(
    opts: {
        graphStoreBackend?: string;
        [key: string]: unknown;
    } = {},
): OrchidGraphStore {
    const name = opts.graphStoreBackend ?? "null";
    const builder = GRAPH_STORE_BACKEND_REGISTRY[name];
    if (!builder) throw new Error(formatMissingBackendError(name, "graphStore"));
    return builder(opts);
}

export function registerSparseEncoderBackend(
    _name: string,
    _cls: new () => OrchidSparseEncoder,
): void {
    const { registerSparseEncoder } = require("./sparse/index.js");
    registerSparseEncoder(_name, _cls);
}

export async function buildSparseEncoder(
    opts: {
        sparseEncoder?: string;
        [key: string]: unknown;
    } = {},
): Promise<OrchidSparseEncoder> {
    const { getSparseEncoder } = await import("./sparse/index.js");
    return getSparseEncoder(opts.sparseEncoder ?? "bm25");
}

function buildNullReader(_opts?: Record<string, unknown>): OrchidVectorReader {
    return new NullVectorReader();
}

function buildNullDocStore(_opts?: Record<string, unknown>): OrchidDocStore {
    return new NullDocStore();
}

function buildInMemoryDocStore(_opts?: Record<string, unknown>): OrchidDocStore {
    return new InMemoryDocStore();
}

function buildNullGraphStore(_opts?: Record<string, unknown>): OrchidGraphStore {
    return new NullGraphStore();
}

function buildInMemoryGraphStore(_opts?: Record<string, unknown>): OrchidGraphStore {
    return new InMemoryGraphStore();
}

registerVectorBackend("null", buildNullReader);
registerDocStoreBackend("null", buildNullDocStore);
registerDocStoreBackend("in_memory", buildInMemoryDocStore);
registerGraphStoreBackend("null", buildNullGraphStore);
registerGraphStoreBackend("in_memory", buildInMemoryGraphStore);
