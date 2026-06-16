import { z } from "zod";
import { OrchidQueryTransformerPromptsConfigSchema } from "./prompts.js";

export const OrchidIngestionConfigSchema = z
    .object({
        strategy: z.string().nullable().default(null),
        chunkSize: z.number().int().min(1).default(1000),
        chunkOverlap: z.number().int().min(0).default(200),
        parentChunkSize: z.number().int().min(0).default(0),
        parentChunkOverlap: z.number().int().min(0).default(200),
        postProcessors: z.array(z.string()).default([]),
    })
    .strict();

export type OrchidIngestionConfig = z.infer<typeof OrchidIngestionConfigSchema>;

export const OrchidHydeConfigSchema = z
    .object({
        nHypothetical: z.number().int().min(1).default(1),
    })
    .strict();

export type OrchidHydeConfig = z.infer<typeof OrchidHydeConfigSchema>;

export const OrchidHybridConfigSchema = z
    .object({
        sparseEncoder: z.string().default("bm25"),
        sparseWeight: z.number().min(0).max(1).default(0.4),
        fusion: z.enum(["rrf", "linear"]).default("rrf"),
        rrfK: z.number().int().min(1).default(60),
    })
    .strict();

export type OrchidHybridConfig = z.infer<typeof OrchidHybridConfigSchema>;

export const OrchidGraphRetrievalConfigSchema = z
    .object({
        enabled: z.boolean().default(false),
        maxHops: z.number().int().min(1).default(2),
        fuseWithVectors: z.boolean().default(true),
        relationFilter: z.array(z.string()).default([]),
    })
    .strict();

export type OrchidGraphRetrievalConfig = z.infer<typeof OrchidGraphRetrievalConfigSchema>;

export const OrchidRetrievalConfigSchema = z
    .object({
        strategy: z.string().nullable().default(null),
        queryTransformers: z.array(z.string()).nullable().default(null),
        metadataFilters: z.record(z.string(), z.unknown()).default({}),
        excludeDynamic: z.boolean().default(false),
        hyde: OrchidHydeConfigSchema.default({}),
        hybrid: OrchidHybridConfigSchema.default({}),
        graph: OrchidGraphRetrievalConfigSchema.default({}),
        transformerPrompts: OrchidQueryTransformerPromptsConfigSchema.default({}),
    })
    .strict();

export type OrchidRetrievalConfig = z.infer<typeof OrchidRetrievalConfigSchema>;

export const OrchidRAGDefaultsConfigSchema = z
    .object({
        k: z.number().int().min(1).default(5),
        enabled: z.boolean().default(true),
        ragTtl: z.number().int().min(0).default(0),
        maxContextChars: z.number().int().min(0).default(3000),
        ingestion: OrchidIngestionConfigSchema.default({}),
        retrieval: OrchidRetrievalConfigSchema.default({}),
    })
    .strict();

export type OrchidRAGDefaultsConfig = z.infer<typeof OrchidRAGDefaultsConfigSchema>;

export const OrchidRAGConfigSchema = z
    .object({
        namespace: z.string().default(""),
        k: z.number().int().min(1).default(5),
        enabled: z.boolean().default(true),
        ragTtl: z.number().int().min(0).default(0),
        maxContextChars: z.number().int().nullable().default(null),
        ingestion: OrchidIngestionConfigSchema.default({}),
        retrieval: OrchidRetrievalConfigSchema.default({}),
        payloadIndexes: z.record(z.string(), z.string()).default({}),
    })
    .strict();

export type OrchidRAGConfig = z.infer<typeof OrchidRAGConfigSchema>;
