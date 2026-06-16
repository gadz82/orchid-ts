import { z } from "zod";

// Default prompt templates (matching Python constants)
const DEFAULT_PRIOR_RESULTS_HEADER = "\n--- Previous Tool Results (from prior turns) ---";
const DEFAULT_MCP_PROMPT_TEMPLATE = "\n--- MCP Prompt: {name} ---\n{text}";
const DEFAULT_SKIPPED_PROMPT_TEMPLATE =
    "\n[Available prompt: {name}] {description} (requires: {requiredArgs})";
const DEFAULT_RESOURCES_HEADER = "\n--- Available Resources ---";
const DEFAULT_RESOURCE_TEMPLATE = "\n[{name}]\n{content}";
const DEFAULT_RAG_HEADER = "\n--- Background Knowledge (RAG) ---";
const DEFAULT_SUMMARISE_HISTORY_REMINDER =
    "\n\nIMPORTANT: The conversation history below shows prior exchanges. " +
    "Always focus on the user's LATEST message and its relationship to " +
    "the most recent topic. Do NOT change topic or introduce unrelated " +
    "content unless the user explicitly asks for something new.";
const DEFAULT_SUMMARISE_PRIOR_RESULTS_HEADER =
    "\n\n--- Previous Tool Results (from prior turns) ---\n";
const DEFAULT_SUMMARISE_RAG_HEADER = "Background knowledge (from RAG):\n";
const DEFAULT_SUMMARISE_USER_TEMPLATE =
    "User query: {query}\n\n{ragSection}Live data (from API):\n{mcpData}";

// Default compression prompts (stubs — consumers override as needed)
const DEFAULT_STRUCTURED_SUMMARY_SYSTEM_PROMPT =
    "Extract key information from the conversation and produce a structured JSON summary.";
const DEFAULT_STRUCTURED_SUMMARY_USER_PROMPT = "Conversation:\n{history}";
const DEFAULT_STRUCTURED_EXTENSION_SYSTEM_PROMPT =
    "Extend the existing structured summary with new information from the latest conversation turn.";
const DEFAULT_STRUCTURED_EXTENSION_USER_PROMPT =
    "Existing summary:\n{summary}\n\nNew conversation:\n{history}";
const DEFAULT_NARRATIVE_FALLBACK_PROMPT =
    "Summarize the conversation in a concise narrative paragraph.";

export const OrchidAgentPromptConfigSchema = z
    .object({
        priorResultsHeader: z.string().default(DEFAULT_PRIOR_RESULTS_HEADER),
        mcpPromptTemplate: z.string().default(DEFAULT_MCP_PROMPT_TEMPLATE),
        skippedPromptTemplate: z.string().default(DEFAULT_SKIPPED_PROMPT_TEMPLATE),
        resourcesHeader: z.string().default(DEFAULT_RESOURCES_HEADER),
        resourceTemplate: z.string().default(DEFAULT_RESOURCE_TEMPLATE),
        ragHeader: z.string().default(DEFAULT_RAG_HEADER),
        priorResultsMaxChars: z.number().int().min(0).default(4000),
        resourceMaxChars: z.number().int().min(0).default(2000),
        summariseHistoryReminder: z.string().default(DEFAULT_SUMMARISE_HISTORY_REMINDER),
        summarisePriorResultsHeader: z.string().default(DEFAULT_SUMMARISE_PRIOR_RESULTS_HEADER),
        summariseRagSectionHeader: z.string().default(DEFAULT_SUMMARISE_RAG_HEADER),
        summariseUserTemplate: z.string().default(DEFAULT_SUMMARISE_USER_TEMPLATE),
        summarisePriorResultsMaxChars: z.number().int().min(0).default(4000),
        summaryCompressionSystemPrompt: z
            .string()
            .default(DEFAULT_STRUCTURED_SUMMARY_SYSTEM_PROMPT),
        summaryCompressionUserPrompt: z.string().default(DEFAULT_STRUCTURED_SUMMARY_USER_PROMPT),
        summaryExtensionSystemPrompt: z
            .string()
            .default(DEFAULT_STRUCTURED_EXTENSION_SYSTEM_PROMPT),
        summaryExtensionUserPrompt: z.string().default(DEFAULT_STRUCTURED_EXTENSION_USER_PROMPT),
        summaryNarrativeFallbackPrompt: z.string().default(DEFAULT_NARRATIVE_FALLBACK_PROMPT),
    })
    .strict();

export type OrchidAgentPromptConfig = z.infer<typeof OrchidAgentPromptConfigSchema>;

export const OrchidHydeTransformerPromptsConfigSchema = z
    .object({
        single: z.string().nullable().default(null),
        multi: z.string().nullable().default(null),
    })
    .strict();

export type OrchidHydeTransformerPromptsConfig = z.infer<
    typeof OrchidHydeTransformerPromptsConfigSchema
>;

export const OrchidQueryTransformerPromptsConfigSchema = z
    .object({
        multiQuery: z.string().nullable().default(null),
        hyde: OrchidHydeTransformerPromptsConfigSchema.default({}),
        decompose: z.string().nullable().default(null),
        reformulate: z.string().nullable().default(null),
    })
    .strict();

export type OrchidQueryTransformerPromptsConfig = z.infer<
    typeof OrchidQueryTransformerPromptsConfigSchema
>;

// Re-export the default constants for external consumers
export {
    DEFAULT_MCP_PROMPT_TEMPLATE,
    DEFAULT_PRIOR_RESULTS_HEADER,
    DEFAULT_RAG_HEADER,
    DEFAULT_RESOURCE_TEMPLATE,
    DEFAULT_RESOURCES_HEADER,
    DEFAULT_SKIPPED_PROMPT_TEMPLATE,
    DEFAULT_SUMMARISE_HISTORY_REMINDER,
    DEFAULT_SUMMARISE_PRIOR_RESULTS_HEADER,
    DEFAULT_SUMMARISE_RAG_HEADER,
    DEFAULT_SUMMARISE_USER_TEMPLATE,
};
