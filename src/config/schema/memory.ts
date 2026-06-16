import { z } from "zod";

export const OrchidMemoryConfigSchema = z.object({
    strategy: z.enum(["none", "running_summary", "rag_augmented"]).default("none"),
    summaryRecentTurns: z.number().int().min(1).default(10),
    summaryModel: z.string().nullable().default(null),
    summaryPrompt: z.string().nullable().default(null),
    persistSummary: z.boolean().default(true),
    structuredOutput: z.boolean().default(true),
    ragNamespace: z.string().default("__memory__"),
    ragK: z.number().int().min(1).default(5),
    ragSimilarityThreshold: z.number().min(0).max(1).default(0.5),
    storeTurns: z.boolean().default(true),
    truncationStrategy: z.enum(["hard", "middle", "llm", "semantic"]).default("hard"),
    truncationMaxChars: z.number().int().min(100).default(1000),
});

export type OrchidMemoryConfig = z.infer<typeof OrchidMemoryConfigSchema>;
