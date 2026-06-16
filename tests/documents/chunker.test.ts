import { describe, it, expect } from "vitest";
import { chunkText, parentChildChunkText } from "../../src/documents/chunker.js";
import type { ChunkConfig } from "../../src/documents/chunker.js";

describe("chunkText", () => {
    it("returns single chunk for text shorter than chunkSize", () => {
        const result = chunkText("short text", { chunkSize: 500 });
        expect(result).toEqual(["short text"]);
    });

    it("trims whitespace from result", () => {
        const result = chunkText("  padded text  ", { chunkSize: 500 });
        expect(result).toEqual(["padded text"]);
    });

    it("returns empty array for empty input", () => {
        expect(chunkText("")).toEqual([]);
        expect(chunkText("   ")).toEqual([]);
    });

    it("splits on default double-newline separator", () => {
        const text =
            "Paragraph one with some content.\n\nParagraph two with different content.\n\nParagraph three.";
        const result = chunkText(text, { chunkSize: 30, chunkOverlap: 5 });

        expect(result.length).toBeGreaterThan(1);
        // Each paragraph should be in one or more chunks
        const joined = result.join(" ");
        expect(joined).toContain("Paragraph one");
        expect(joined).toContain("Paragraph two");
        expect(joined).toContain("Paragraph three");
    });

    it("respects custom separator", () => {
        const text = "A | B | C | D | E";
        const result = chunkText(text, { chunkSize: 5, separator: " | ", chunkOverlap: 0 });

        expect(result.length).toBeGreaterThanOrEqual(1);
        const joined = result.join("|");
        expect(joined).toContain("A");
        expect(joined).toContain("E");
    });

    it("handles default config when none provided", () => {
        const longText = "x".repeat(2000);
        const result = chunkText(longText);
        expect(result.length).toBeGreaterThan(1);
        // Each chunk should be <= 1000 (default) + some slack for overlap
        for (const chunk of result) {
            expect(chunk.length).toBeLessThanOrEqual(1000);
        }
    });

    it("respects chunkSize and chunkOverlap", () => {
        const text = "0123456789".repeat(50);
        // Force character-level split (no newlines)
        const result = chunkText(text, { chunkSize: 100, chunkOverlap: 20, separator: "\n\n" });

        for (const chunk of result) {
            // Chunks should be <= 100 (allowing for some whitespace handling)
            expect(chunk.length).toBeLessThanOrEqual(100);
        }

        // Total coverage of the original text
        const joined = result.join("");
        // Should contain most of the original digits
        expect(joined).toContain("0123");
    });

    it("handles text exactly at chunkSize boundary", () => {
        const text = "a".repeat(500);
        const result = chunkText(text, { chunkSize: 500 });
        expect(result).toEqual([text]);
    });
});

describe("parentChildChunkText", () => {
    it("returns empty array for empty input", () => {
        expect(parentChildChunkText("")).toEqual([]);
        expect(parentChildChunkText("   ")).toEqual([]);
    });

    it("returns single parent-child for short text", () => {
        const text = "short text";
        const result = parentChildChunkText(text, { chunkSize: 100 });

        expect(result).toHaveLength(1);
        expect(result[0].childText).toBe("short text");
        expect(result[0].parentText).toContain("short text");
        expect(result[0].parentIndex).toBe(0);
        expect(result[0].childIndex).toBe(0);
    });

    it("produces parent-child hierarchy for longer text", () => {
        const text = "A".repeat(500) + "\n\n" + "B".repeat(500) + "\n\n" + "C".repeat(500);

        const result = parentChildChunkText(text, {
            chunkSize: 300,
            chunkOverlap: 50,
            parentChunkSize: 600,
        });

        expect(result.length).toBeGreaterThan(0);
        for (const pc of result) {
            expect(pc.childText).toBeTruthy();
            expect(pc.parentText).toBeTruthy();
            expect(typeof pc.parentIndex).toBe("number");
            expect(typeof pc.childIndex).toBe("number");
        }
    });

    it("respects custom chunk configuration", () => {
        const text = "First block\n\nSecond block\n\nThird block\n\nFourth block";

        const result = parentChildChunkText(text, {
            chunkSize: 15,
            chunkOverlap: 5,
        });

        expect(result.length).toBeGreaterThan(0);
        for (const pc of result) {
            expect(pc.childText.length).toBeLessThanOrEqual(15);
        }
    });

    it("parent indices increment correctly", () => {
        const text = "P1 content here\n\nP2 content here\n\nP3 content here";

        const result = parentChildChunkText(text, {
            chunkSize: 8,
            chunkOverlap: 2,
        });

        const parentIndices = new Set(result.map((pc) => pc.parentIndex));
        expect(parentIndices.size).toBeGreaterThanOrEqual(2);
    });
});
