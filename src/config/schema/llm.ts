import { z } from "zod";

export const OrchidLLMConfigSchema = z.object({
    model: z.string().default("gemini/gemini-2.5-flash"),
    temperature: z.number().min(0).max(2).default(0.2),
    fallbackModel: z.string().nullable().default(null),
    retryAttempts: z.number().int().min(0).default(0),
});

export type OrchidLLMConfig = z.infer<typeof OrchidLLMConfigSchema>;
