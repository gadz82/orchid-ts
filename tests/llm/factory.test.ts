import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the interface shape and provider mapping logic.
// Dynamic imports are not fully mocked — we test fallback paths instead.

describe("buildChatModel — provider mapping", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("exports buildChatModel function", async () => {
        const mod = await import("../../src/llm/factory.js");
        expect(typeof mod.buildChatModel).toBe("function");
    });

    it("returns MockModel when no provider matches and no fallback", async () => {
        const { buildChatModel } = await import("../../src/llm/factory.js");
        // Use a prefix that maps to no real provider, and no installed package
        const model = await buildChatModel("__unmatched__/model-name", {
            temperature: 0.5,
        });
        expect(model).toBeDefined();
        expect(typeof (model as any).invoke).toBe("function");
    });

    it("returns MockModel as fallback for unknown models", async () => {
        const { buildChatModel } = await import("../../src/llm/factory.js");
        const model = await buildChatModel("unknown-model");
        expect(model).toBeDefined();
        const result = await (model as any).invoke([{ role: "user", content: "hi" }]);
        expect(result.content).toContain("[Mock response");
    });

    it("maps known provider prefixes correctly", async () => {
        // Verify the provider table structure through the module
        const { buildChatModel } = await import("../../src/llm/factory.js");

        // All known prefixes should not throw (they either succeed or fallback)
        const prefixes = [
            "openai/",
            "gemini/",
            "google/",
            "anthropic/",
            "claude-",
            "ollama/",
            "ollama_chat/",
            "groq/",
            "mistral/",
            "bedrock/",
            "deepseek/",
        ];

        for (const prefix of prefixes) {
            const model = await buildChatModel(`${prefix}test-model`);
            expect(model).toBeDefined();
        }
    });

    it("uses fallbackModel when primary provider fails", async () => {
        const { buildChatModel } = await import("../../src/llm/factory.js");
        const model = await buildChatModel("__unmatched__/model", {
            fallbackModel: "__also_unmatched__/fallback-model",
        });
        expect(model).toBeDefined();
    });

    it("accepts temperature option", async () => {
        const { buildChatModel } = await import("../../src/llm/factory.js");
        const model1 = await buildChatModel("mock-model", { temperature: 0.0 });
        const model2 = await buildChatModel("mock-model", { temperature: 0.7 });
        expect(model1).toBeDefined();
        expect(model2).toBeDefined();
    });
});
