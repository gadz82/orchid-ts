import { describe, it, expect, beforeEach } from "vitest";
import { SystemPromptBuilder } from "../../src/agents/promptBuilder.js";
import type { MCPCapabilities } from "../../src/agents/mcpDispatcher.js";
import { OrchidAgentPromptConfigSchema } from "../../src/config/schema/prompts.js";

function makeCaps(overrides: Partial<MCPCapabilities> = {}): MCPCapabilities {
    const defaults: MCPCapabilities = {
        rawTools: [],
        toolClientMap: new Map(),
        toolAnnotations: new Map(),
        renderedPrompts: [],
        resourceContents: new Map(),
        skippedPrompts: [],
    };
    return { ...defaults, ...overrides };
}

function makeDefaultPromptConfig() {
    return OrchidAgentPromptConfigSchema.parse({});
}

describe("SystemPromptBuilder", () => {
    let builder: SystemPromptBuilder;

    beforeEach(() => {
        builder = new SystemPromptBuilder(makeDefaultPromptConfig());
    });

    it("returns base prompt alone when no additional context", () => {
        const caps = makeCaps();
        const result = builder.build("You are a helpful assistant.", {
            caps,
            ragData: [],
            agentName: "test",
        });

        expect(result).toBe("You are a helpful assistant.");
    });

    it("includes prior tool results from state", () => {
        const caps = makeCaps();
        const state = {
            mcp_context: {
                test: { tool_a: "result a", tool_b: 42 },
            },
        };

        const result = builder.build("Base prompt.", {
            caps,
            ragData: [],
            state,
            agentName: "test",
        });

        expect(result).toContain("Base prompt.");
        expect(result).toContain("Previous Tool Results");
        expect(result).toContain("tool_a");
        expect(result).toContain("result a");
    });

    it("does not include prior results when agent key is missing", () => {
        const caps = makeCaps();
        const state = {
            mcp_context: { other_agent: { data: "x" } },
        };

        const result = builder.build("Base prompt.", {
            caps,
            ragData: [],
            state,
            agentName: "test",
        });

        // Should not contain the data from other_agent since we look for state['mcp_context'][agentName]
        expect(result).not.toContain("data");
    });

    it("includes rendered MCP prompts", () => {
        const caps = makeCaps({
            renderedPrompts: [
                { name: "greeting", text: "Hello, user!" },
                { name: "status", text: "All systems operational." },
            ],
        });

        const result = builder.build("Base.", {
            caps,
            ragData: [],
            agentName: "t",
        });

        expect(result).toContain("MCP Prompt: greeting");
        expect(result).toContain("Hello, user!");
        expect(result).toContain("MCP Prompt: status");
    });

    it("includes skipped prompts with required arguments", () => {
        const caps = makeCaps({
            skippedPrompts: [
                { name: "report", description: "Generate report", requiredArgs: ["date", "type"] },
            ],
        });

        const result = builder.build("Base.", {
            caps,
            ragData: [],
            agentName: "t",
        });

        expect(result).toContain("Available prompt: report");
        expect(result).toContain("Generate report");
        expect(result).toContain("requires: date, type");
    });

    it("includes resource contents", () => {
        const caps = makeCaps({
            resourceContents: new Map([["config.json", '{"key": "value"}']]),
        });

        const result = builder.build("Base.", {
            caps,
            ragData: [],
            agentName: "t",
        });

        expect(result).toContain("Available Resources");
        expect(result).toContain("[config.json]");
        expect(result).toContain('{"key": "value"}');
    });

    it("includes RAG context data", () => {
        const caps = makeCaps();
        const ragData = [{ title: "Doc 1", content: "Important info" }];

        const result = builder.build("Base.", {
            caps,
            ragData,
            agentName: "t",
        });

        expect(result).toContain("Background Knowledge (RAG)");
        expect(result).toContain("Important info");
    });

    it("respects ragMaxContextChars limit", () => {
        const caps = makeCaps();
        const ragData = [{ huge: "x".repeat(5000) }];

        const result = builder.build("Base.", {
            caps,
            ragData,
            agentName: "t",
            ragMaxContextChars: 50,
        });

        // Should be capped at 50 chars
        const ragSectionIndex = result.indexOf("Background Knowledge");
        const ragSection = result.slice(ragSectionIndex);
        expect(ragSection.length).toBeLessThan(100); // header + 50 chars max
    });

    it("handles all sections together", () => {
        const caps = makeCaps({
            renderedPrompts: [{ name: "greet", text: "Hi!" }],
            skippedPrompts: [{ name: "analyze", description: "Analysis", requiredArgs: ["input"] }],
            resourceContents: new Map([["file1", "content1"]]),
        });

        const state = { mcp_context: { t: { prev: "result" } } };
        const ragData = [{ doc: "knowledge" }];

        const result = builder.build("You are helpful.", {
            caps,
            ragData,
            state,
            agentName: "t",
        });

        expect(result).toContain("You are helpful.");
        expect(result).toContain("Previous Tool Results");
        expect(result).toContain("MCP Prompt: greet");
        expect(result).toContain("Available prompt: analyze");
        expect(result).toContain("Available Resources");
        expect(result).toContain("file1");
        expect(result).toContain("Background Knowledge");
    });
});
