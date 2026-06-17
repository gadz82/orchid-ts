import { z } from "zod";

export const OrchidLLMConfigSchema = z.object({
    model: z.string().default("gemini/gemini-2.5-flash"),
    temperature: z.number().min(0).max(2).default(0.2),
    fallbackModel: z.string().nullable().default(null),
    retryAttempts: z.number().int().min(0).default(0),
    /**
     * Base URL for Ollama-compatible providers. Mirrors the Python
     * `llm.ollama_api_base` field. Overrides the `OLLAMA_API_BASE`
     * env var when set. Leave null/empty to use the env var or the
     * provider's default endpoint.
     */
    ollamaApiBase: z.string().nullable().default(null),
});

export type OrchidLLMConfig = z.infer<typeof OrchidLLMConfigSchema>;

