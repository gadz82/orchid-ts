import { z } from "zod";

export const OrchidMiniAgentConfigSchema = z
    .object({
        enabled: z.boolean().default(false),
        maxCount: z.number().int().min(2).max(8).default(3),
        decomposerModel: z.string().nullable().default(null),
        timeoutSeconds: z.number().int().min(5).max(600).default(60),
        toolAllowlistMode: z.enum(["strict", "parent_full", "inferred"]).default("strict"),
        streamInnerTokens: z.boolean().default(false),
        decomposerPrompt: z.string().nullable().default(null),
        aggregatorPrompt: z.string().nullable().default(null),
        systemPromptTemplate: z.string().nullable().default(null),
    })
    .strict();

export type OrchidMiniAgentConfig = z.infer<typeof OrchidMiniAgentConfigSchema>;
