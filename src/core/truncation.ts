/** Message truncation strategies. */

export enum OrchidTruncationStrategy {
    HARD = "hard",
    MIDDLE = "middle",
    LLM = "llm",
    SEMANTIC = "semantic",
}

const TRUNCATION_MARKER = "\u2026[truncated]\u2026";

export function truncateContent(
    content: string,
    maxChars: number,
    strategy: OrchidTruncationStrategy = OrchidTruncationStrategy.HARD,
): string {
    if (content.length <= maxChars) return content;

    if (strategy === OrchidTruncationStrategy.HARD) {
        return content.slice(0, maxChars - 1) + "\u2026";
    }

    if (strategy === OrchidTruncationStrategy.MIDDLE) {
        return truncateMiddle(content, maxChars);
    }

    return truncateMiddle(content, maxChars);
}

export async function truncateContentAsync(
    content: string,
    maxChars: number,
    strategy: OrchidTruncationStrategy = OrchidTruncationStrategy.HARD,
    chatModel?: unknown,
    _query?: string,
): Promise<string> {
    if (content.length <= maxChars) return content;

    if (strategy === OrchidTruncationStrategy.HARD) {
        return content.slice(0, maxChars - 1) + "\u2026";
    }

    if (strategy === OrchidTruncationStrategy.MIDDLE) {
        return truncateMiddle(content, maxChars);
    }

    if (strategy === OrchidTruncationStrategy.LLM) {
        if (!chatModel) return truncateMiddle(content, maxChars);
        try {
            return await truncateLLM(content, maxChars, chatModel);
        } catch {
            return truncateMiddle(content, maxChars);
        }
    }

    if (strategy === OrchidTruncationStrategy.SEMANTIC) {
        return truncateMiddle(content, maxChars);
    }

    return truncateMiddle(content, maxChars);
}

function truncateMiddle(content: string, maxChars: number): string {
    const headSize = Math.floor(maxChars * 0.4);
    const tailSize = Math.floor(maxChars * 0.4);
    const remaining = maxChars - headSize - tailSize - TRUNCATION_MARKER.length;

    if (remaining < 0) return content.slice(0, maxChars - 1) + "\u2026";

    return content.slice(0, headSize) + TRUNCATION_MARKER + content.slice(-tailSize);
}

async function truncateLLM(content: string, maxChars: number, chatModel: any): Promise<string> {
    const prompt = [
        `Summarise the following text concisely in no more than ${maxChars} characters.`,
        "Preserve key facts, numbers, and names. Do not add commentary.",
        "",
        content,
    ].join("\n");

    const result = await chatModel.ainvoke([{ role: "user", content: prompt }], {
        temperature: 0.0,
    });
    const summary = result.content || "";
    return summary.length > maxChars ? summary.slice(0, maxChars) : summary;
}
