const PREFIX_TO_API_KEY_ENV: Array<[string, string]> = [
    ["gemini/", "GEMINI_API_KEY"],
    ["google/", "GEMINI_API_KEY"],
    ["groq/", "GROQ_API_KEY"],
    ["anthropic/", "ANTHROPIC_API_KEY"],
    ["claude-", "ANTHROPIC_API_KEY"],
    ["openai/", "OPENAI_API_KEY"],
    ["deepseek/", "DEEPSEEK_API_KEY"],
    ["mistral/", "MISTRAL_API_KEY"],
    ["cohere/", "COHERE_API_KEY"],
    ["together_ai/", "TOGETHERAI_API_KEY"],
];

const PREFIX_TO_API_BASE_ENV: Array<[string, string]> = [
    ["ollama/", "OLLAMA_API_BASE"],
    ["ollama_chat/", "OLLAMA_API_BASE"],
];

export function getLlmKwargs(model: string): Record<string, string> {
    const kwargs: Record<string, string> = {};

    for (const [prefix, envVar] of PREFIX_TO_API_KEY_ENV) {
        if (model.startsWith(prefix)) {
            const key = process.env[envVar];
            if (key) {
                kwargs["api_key"] = key;
            }
            break;
        }
    }

    for (const [prefix, envVar] of PREFIX_TO_API_BASE_ENV) {
        if (model.startsWith(prefix)) {
            const baseUrl = process.env[envVar];
            if (baseUrl) {
                kwargs["api_base"] = baseUrl;
            }
            break;
        }
    }

    return kwargs;
}

export function getEmbeddingKwargs(model: string): Record<string, string> {
    const kwargs: Record<string, string> = {};

    if (model.startsWith("gemini/") || model.startsWith("google/")) {
        const key = process.env["GEMINI_API_KEY"];
        if (key) kwargs["api_key"] = key;
    }

    if (model.startsWith("openai/")) {
        const key = process.env["OPENAI_API_KEY"];
        if (key) kwargs["api_key"] = key;
    }

    if (model.startsWith("ollama/")) {
        const baseUrl = process.env["OLLAMA_API_BASE"];
        if (baseUrl) kwargs["api_base"] = baseUrl;
    }

    return kwargs;
}
