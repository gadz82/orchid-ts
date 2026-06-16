import { describe, it, expect } from "vitest";
import {
    OrchidLLMConfigSchema,
    OrchidContentSourceConfigSchema,
    OrchidMemoryConfigSchema,
    OrchidGuardrailsConfigSchema,
    OrchidGuardrailRuleConfigSchema,
    OrchidSupervisorConfigSchema,
    OrchidMiniAgentConfigSchema,
    OrchidConfigStorageConfigSchema,
} from "../../src/config/schema/index.js";

describe("Config Schema - LLM", () => {
    it("parses default LLM config", () => {
        const result = OrchidLLMConfigSchema.parse({});
        expect(result.model).toBe("gemini/gemini-2.5-flash");
        expect(result.temperature).toBe(0.2);
        expect(result.fallbackModel).toBeNull();
        expect(result.retryAttempts).toBe(0);
    });

    it("parses custom LLM config", () => {
        const result = OrchidLLMConfigSchema.parse({
            model: "openai/gpt-4o",
            temperature: 0.7,
            fallbackModel: "gemini/gemini-flash",
            retryAttempts: 3,
        });
        expect(result.model).toBe("openai/gpt-4o");
        expect(result.temperature).toBe(0.7);
        expect(result.retryAttempts).toBe(3);
    });
});

describe("Config Schema - Content", () => {
    it("parses default content source config", () => {
        const result = OrchidContentSourceConfigSchema.parse({ path: "/data" });
        expect(result.path).toBe("/data");
        expect(result.source).toBe("local");
        expect(result.fileExtensions).toEqual([".pdf", ".txt", ".md", ".docx", ".xlsx", ".csv"]);
    });
});

describe("Config Schema - Memory", () => {
    it("parses default memory config", () => {
        const result = OrchidMemoryConfigSchema.parse({});
        expect(result.strategy).toBe("none");
        expect(result.summaryRecentTurns).toBe(10);
        expect(result.persistSummary).toBe(true);
        expect(result.truncationStrategy).toBe("hard");
        expect(result.truncationMaxChars).toBe(1000);
    });
});

describe("Config Schema - Guardrails", () => {
    it("parses guardrail rule", () => {
        const result = OrchidGuardrailRuleConfigSchema.parse({
            type: "content_safety",
            failAction: "block",
            config: { categories: ["self_harm"] },
        });
        expect(result.type).toBe("content_safety");
        expect(result.failAction).toBe("block");
        expect(result.config).toEqual({ categories: ["self_harm"] });
    });

    it("parses guardrails config with input and output", () => {
        const result = OrchidGuardrailsConfigSchema.parse({
            input: [{ type: "prompt_injection", failAction: "block" }],
            output: [{ type: "pii_detection", failAction: "redact" }],
        });
        expect(result.input).toHaveLength(1);
        expect(result.output).toHaveLength(1);
    });
});

describe("Config Schema - Supervisor", () => {
    it("parses default supervisor config", () => {
        const result = OrchidSupervisorConfigSchema.parse({});
        expect(result.assistantName).toBe("AI assistant");
        expect(result.streamingEnabled).toBe(true);
        expect(result.historyMaxTurns).toBe(20);
        expect(result.historyMaxChars).toBe(1000);
        expect(result.historySummaryEnabled).toBe(true);
        expect(result.historySummaryRecentTurns).toBe(10);
    });
});

describe("Config Schema - MiniAgent", () => {
    it("parses default mini-agent config", () => {
        const result = OrchidMiniAgentConfigSchema.parse({});
        expect(result.enabled).toBe(false);
        expect(result.maxCount).toBe(3);
        expect(result.timeoutSeconds).toBe(60);
        expect(result.toolAllowlistMode).toBe("strict");
    });

    it("validates maxCount bounds", () => {
        expect(() => OrchidMiniAgentConfigSchema.parse({ maxCount: 1 })).toThrow();
        expect(() => OrchidMiniAgentConfigSchema.parse({ maxCount: 9 })).toThrow();
    });
});

describe("Config Schema - Storage", () => {
    it("parses default config storage", () => {
        const result = OrchidConfigStorageConfigSchema.parse({});
        expect(result.enabled).toBe(false);
        expect(result.class).toBe("");
        expect(result.dsn).toBe("");
    });

    it("parses enabled config storage", () => {
        const result = OrchidConfigStorageConfigSchema.parse({
            enabled: true,
            class: "myorg.config.Storage",
            dsn: "postgresql://localhost/db",
        });
        expect(result.enabled).toBe(true);
        expect(result.dsn).toBe("postgresql://localhost/db");
    });
});
