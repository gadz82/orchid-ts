import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillDetector } from "../../src/agents/skillDetector.js";
import type { OrchidAgentSkillConfig } from "../../src/config/schema/index.js";

describe("SkillDetector", () => {
    let mockChatModel: { invoke: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockChatModel = { invoke: vi.fn() };
    });

    it("returns null when there are no skills", async () => {
        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("some query", {});
        expect(result).toBeNull();
        expect(mockChatModel.invoke).not.toHaveBeenCalled();
    });

    it("returns matched skill name when LLM responds with a valid skill", async () => {
        mockChatModel.invoke.mockResolvedValue({ content: "summarize" });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
            translate: { description: "Translate text", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("Can you summarize this document?", skills);

        expect(result).toBe("summarize");
        expect(mockChatModel.invoke).toHaveBeenCalledTimes(1);
        const [messages, options] = mockChatModel.invoke.mock.calls[0];
        expect(messages[0].role).toBe("user");
        expect(messages[0].content).toContain("summarize");
        expect(messages[0].content).toContain("translate");
        expect(options).toEqual({ temperature: 0 });
    });

    it('returns null when LLM responds with "none"', async () => {
        mockChatModel.invoke.mockResolvedValue({ content: "none" });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("random query", skills);

        expect(result).toBeNull();
    });

    it("returns null when LLM responds with unknown skill name", async () => {
        mockChatModel.invoke.mockResolvedValue({ content: "unknown_skill" });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("query", skills);

        expect(result).toBeNull();
    });

    it("strips surrounding quotes from LLM response", async () => {
        mockChatModel.invoke.mockResolvedValue({ content: '"summarize"' });

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("summarize please", skills);

        expect(result).toBe("summarize");
    });

    it("returns null on LLM error", async () => {
        mockChatModel.invoke.mockRejectedValue(new Error("LLM API error"));

        const skills: Record<string, OrchidAgentSkillConfig> = {
            summarize: { description: "Summarize content", steps: [] },
        };

        const detector = new SkillDetector(mockChatModel as any);
        const result = await detector.detect("query", skills);

        expect(result).toBeNull();
    });
});
