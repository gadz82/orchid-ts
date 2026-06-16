import { z } from "zod";
import { OrchidMemoryConfigSchema } from "./memory.js";

export const ExecutionHintsSchema = z.object({
    parallelSafe: z.boolean().default(true),
});

export type ExecutionHints = z.infer<typeof ExecutionHintsSchema>;

export const OrchidSupervisorConfigSchema = z.object({
    assistantName: z.string().default("AI assistant"),
    fallbackModel: z.string().nullable().default(null),
    streamingEnabled: z.boolean().default(true),
    routingSystemPrompt: z.string().nullable().default(null),
    synthesisSystemPrompt: z.string().nullable().default(null),
    sequentialAdvancePrompt: z.string().nullable().default(null),
    historyMaxTurns: z.number().int().min(1).default(20),
    historyMaxChars: z.number().int().min(1).default(1000),
    routingModel: z.string().nullable().default(null),
    historySummaryEnabled: z.boolean().default(true),
    historySummaryModel: z.string().nullable().default(null),
    historySummaryRecentTurns: z.number().int().min(1).default(10),
    skipSynthesisWhenSingleAgent: z.boolean().default(true),
    memory: OrchidMemoryConfigSchema.default({}),
});

export type OrchidSupervisorConfig = z.infer<typeof OrchidSupervisorConfigSchema>;
