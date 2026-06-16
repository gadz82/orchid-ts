export function formatLlmError(exc: unknown, context?: string): string {
    const ctx = context ? ` [${context}]` : "";

    if (exc instanceof Error) {
        const msg = exc.message ?? "";

        if (msg.includes("503") || msg.includes("Service Unavailable")) {
            return `LLM service unavailable — the model is experiencing high demand. Please try again later.${ctx}`;
        }

        if (
            msg.includes("429") ||
            msg.includes("rate limit") ||
            msg.includes("RateLimitError") ||
            msg.includes("quota") ||
            msg.includes("RESOURCE_EXHAUSTED")
        ) {
            return `LLM rate limit exceeded. Please wait a moment before retrying.${ctx}`;
        }

        if (msg.includes("401") || msg.includes("403") || msg.includes("Unauthorized")) {
            return `LLM authentication failed — check your API key.${ctx}`;
        }

        if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET")) {
            return `LLM request timed out — the model may be overloaded. Please try again.${ctx}`;
        }

        if (msg.length < 200) {
            return `LLM error: ${msg}${ctx}`;
        }

        return `LLM error occurred.${ctx}`;
    }

    if (typeof exc === "string") {
        return `LLM error: ${exc}${ctx}`;
    }

    return `An unexpected LLM error occurred.${ctx}`;
}
