import { describe, it, expect } from "vitest";
import {
    truncateContent,
    truncateContentAsync,
    OrchidTruncationStrategy,
} from "../../src/core/truncation.js";

describe("truncateContent", () => {
    it("returns content unchanged if within limit", () => {
        expect(truncateContent("hello", 10)).toBe("hello");
    });

    it("hard truncation adds ellipsis", () => {
        const result = truncateContent(
            "hello world this is long",
            10,
            OrchidTruncationStrategy.HARD,
        );
        expect(result.length).toBeLessThanOrEqual(10);
        expect(result.endsWith("\u2026")).toBe(true);
    });

    it("middle truncation preserves start and end", () => {
        const longStr = "a".repeat(200);
        const result = truncateContent(longStr, 100, OrchidTruncationStrategy.MIDDLE);
        expect(result).toContain("\u2026[truncated]\u2026");
        expect(result.startsWith("a")).toBe(true);
        expect(result.endsWith("a")).toBe(true);
    });

    it("llm and semantic fall back to middle", () => {
        const longStr = "a".repeat(200);
        const r1 = truncateContent(longStr, 100, OrchidTruncationStrategy.LLM);
        expect(r1).toContain("\u2026[truncated]\u2026");
        const r2 = truncateContent(longStr, 100, OrchidTruncationStrategy.SEMANTIC);
        expect(r2).toContain("\u2026[truncated]\u2026");
    });
});

describe("truncateContentAsync", () => {
    it("hard truncation is synchronous", async () => {
        const result = await truncateContentAsync(
            "hello world long",
            10,
            OrchidTruncationStrategy.HARD,
        );
        expect(result.length).toBeLessThanOrEqual(10);
    });

    it("llm falls back to middle when no model", async () => {
        const longStr = "a".repeat(200);
        const result = await truncateContentAsync(longStr, 100, OrchidTruncationStrategy.LLM);
        expect(result).toContain("\u2026[truncated]\u2026");
    });
});
