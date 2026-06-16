import { describe, it, expect } from "vitest";
import {
    OrchidBuiltinToolConfigSchema,
    BuiltinToolParameterSchema,
    OrchidAgentSkillConfigSchema,
    OrchidAgentSkillStepConfigSchema,
    OrchidOrchestratorSkillConfigSchema,
    OrchidOrchestratorSkillStepConfigSchema,
} from "../../src/config/schema/index.js";

describe("Config Schema - Skills & Tools", () => {
    it("parses builtin tool parameter", () => {
        const result = BuiltinToolParameterSchema.parse({
            type: "string",
            description: "Player name",
            required: false,
            default: "",
        });
        expect(result.type).toBe("string");
        expect(result.description).toBe("Player name");
        expect(result.required).toBe(false);
    });

    it("parses builtin tool config with class", () => {
        const result = OrchidBuiltinToolConfigSchema.parse({
            class: "myorg.tools.SearchTool",
            description: "Search documents",
        });
        expect(result.class).toBe("myorg.tools.SearchTool");
        expect(result.description).toBe("Search documents");
        expect(result.injectToRag).toBe(false);
    });

    it("parses builtin tool config with handler", () => {
        const result = OrchidBuiltinToolConfigSchema.parse({
            handler: "myorg.tools.search",
            description: "Search",
        });
        expect(result.handler).toBe("myorg.tools.search");
    });

    it("rejects tool without class or handler", () => {
        expect(() =>
            OrchidBuiltinToolConfigSchema.parse({
                description: "Bad tool",
            }),
        ).toThrow();
    });

    it("parses agent skill step (tool call)", () => {
        const result = OrchidAgentSkillStepConfigSchema.parse({
            tool: "search",
            source: "mcp_server",
        });
        expect(result.tool).toBe("search");
        expect(result.source).toBe("mcp_server");
    });

    it("parses agent skill step (agent invocation)", () => {
        const result = OrchidAgentSkillStepConfigSchema.parse({
            agent: "analyst",
            instruction: "Analyze data",
        });
        expect(result.agent).toBe("analyst");
        expect(result.instruction).toBe("Analyze data");
    });

    it("rejects skill step with both tool and agent", () => {
        expect(() =>
            OrchidAgentSkillStepConfigSchema.parse({
                tool: "search",
                agent: "analyst",
            }),
        ).toThrow();
    });

    it("rejects skill step with neither tool nor agent", () => {
        expect(() =>
            OrchidAgentSkillStepConfigSchema.parse({
                source: "mcp_server",
            }),
        ).toThrow();
    });

    it("parses agent skill config", () => {
        const result = OrchidAgentSkillConfigSchema.parse({
            description: "Search workflow",
            steps: [{ tool: "search" }, { tool: "analyze", source: "builtin" }],
        });
        expect(result.description).toBe("Search workflow");
        expect(result.steps).toHaveLength(2);
    });

    it("parses orchestrator skill config", () => {
        const result = OrchidOrchestratorSkillConfigSchema.parse({
            description: "Cross-agent pipeline",
            steps: [
                { agent: "research", instruction: "Find data" },
                { agent: "writing", instruction: "Draft report" },
            ],
        });
        expect(result.steps).toHaveLength(2);
        expect(result.steps[0].agent).toBe("research");
    });
});
