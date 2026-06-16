/** Ingestion strategy + chunk post-processor registries. */

import type { OrchidIngestionStrategy, OrchidChunkPostProcessor } from "../../core/ingestion.js";
import type { ChunkConfig } from "../chunker.js";
import { RecursiveIngestion } from "./recursive.js";
import { SemanticIngestion } from "./semantic.js";
import { HierarchicalIngestion } from "./hierarchical.js";
import { HeaderedIngestion } from "./headered.js";
import { ContextualHeaderPostProcessor } from "../postProcessors/contextualHeaders.js";
import { EntityExtractionPostProcessor } from "../postProcessors/entityExtraction.js";

// ── Built-in registries ──────────────────────────────────────────

const _INGESTION_BUILTINS: Record<string, new (...args: any[]) => OrchidIngestionStrategy> = {
    recursive: RecursiveIngestion,
    semantic: SemanticIngestion,
    hierarchical: HierarchicalIngestion,
    headered: HeaderedIngestion,
};

const _POST_PROCESSOR_BUILTINS: Record<string, new (...args: any[]) => OrchidChunkPostProcessor> = {
    contextual_headers: ContextualHeaderPostProcessor,
    entity_extraction: EntityExtractionPostProcessor,
};

export const INGESTION_REGISTRY: Record<string, new (...args: any[]) => OrchidIngestionStrategy> = {
    ..._INGESTION_BUILTINS,
};
export const POST_PROCESSOR_REGISTRY: Record<
    string,
    new (...args: any[]) => OrchidChunkPostProcessor
> = { ..._POST_PROCESSOR_BUILTINS };

// ── Ingestion strategies ─────────────────────────────────────────

const _CHUNK_CONFIG_STRATEGIES = new Set<new (...args: any[]) => OrchidIngestionStrategy>([
    RecursiveIngestion,
    HierarchicalIngestion,
    HeaderedIngestion,
]);

export function registerIngestionStrategy(
    name: string,
    cls: new (...args: any[]) => OrchidIngestionStrategy,
): void {
    INGESTION_REGISTRY[name] = cls;
}

export function getIngestionStrategy(name: string): OrchidIngestionStrategy {
    let cls = INGESTION_REGISTRY[name];
    if (!cls) {
        cls = INGESTION_REGISTRY["recursive"] ?? RecursiveIngestion;
    }
    return new cls();
}

export function buildIngestionStrategy(config: {
    strategy?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    parentChunkSize?: number;
    parentChunkOverlap?: number;
}): OrchidIngestionStrategy {
    const name = config.strategy || "recursive";
    let cls = INGESTION_REGISTRY[name];
    if (!cls) {
        cls = INGESTION_REGISTRY["recursive"] ?? RecursiveIngestion;
    }

    if (_CHUNK_CONFIG_STRATEGIES.has(cls)) {
        const chunkConfig: ChunkConfig = {
            chunkSize: config.chunkSize,
            chunkOverlap: config.chunkOverlap,
            parentChunkSize: config.parentChunkSize,
            parentChunkOverlap: config.parentChunkOverlap,
        };
        return new cls(chunkConfig);
    }
    return new cls();
}

// ── Chunk post-processors ────────────────────────────────────────

export function registerPostProcessor(
    name: string,
    cls: new (...args: any[]) => OrchidChunkPostProcessor,
): void {
    POST_PROCESSOR_REGISTRY[name] = cls;
}

export function getPostProcessor(name: string): OrchidChunkPostProcessor {
    const cls = POST_PROCESSOR_REGISTRY[name];
    if (!cls) {
        const registered = Object.keys(POST_PROCESSOR_REGISTRY).sort();
        throw new Error(
            `Unknown chunk post-processor '${name}'. Registered: ${registered.join(", ")}. ` +
                `Call registerPostProcessor('${name}', cls) before use.`,
        );
    }
    return new cls();
}
