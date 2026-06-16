import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillDetector } from "../../src/agents/skillDetector.js";
import type { OrchidAgentSkillConfig } from "../../src/config/schema/index.js";

describe("SkillDetector", () => {
    let mockChatModel: { ainvoke: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockChatModel = { ainvoke: vi.fn() };
    });

    it("returns null when there are no skills", async () => {
        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("some query", {});
        expect(result).toBeNull();
        expect(mockChatModel.ainvoke).not.toHaveBeenCalled();
    });

    it("returns matched skill name when LLM responds with a valid skill", async () => {
        mockChatModel.ainvoke.mockResolvedValue({ content: "summarize" });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
            translate: { description: "Translate text", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("Can you summarize this document?", skills);

        expect(result).toBe("summarize");
        expect(mockChatModel.ainvoke).toHaveBeenCalledTimes(1);
        const [messages, options] = mockChatModel.ainvoke.mock.calls[0];
        expect(messages[0].role).toBe("user");
        expect(messages[0].content).toContain("summarize");
        expect(messages[0].content).toContain("translate");
        expect(options).toEqual({ temperature: 0 });
    });

    it('returns null when LLM responds with "none"', async () => {
        mockChatModel.ainvoke.mockResolvedValue({ content: "none" });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("random query", skills);

        expect(result).toBeNull();
    });

    it("returns null when LLM responds with unknown skill name", async () => {
        mockChatModel.ainvoke.mockResolvedValue({ content: "unknown_skill" });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("query", skills);

        expect(result).toBeNull();
    });

    it("strips surrounding quotes from LLM response", async () => {
        mockChatModel.ainvoke.mockResolvedValue({ content: '"summarize"' });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("summarize please", skills);

        expect(result).toBe("summarize");
    });

    it("returns null on LLM error", async () => {
        mockChatModel.ainvoke.mockRejectedValue(new Error("LLM API error"));

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("query", skills);

        expect(result).toBeNull();
    });
});
