import { describe, it, expect } from "vitest";
import {
    OrchidMCPServerConfigSchema,
    OrchidMCPAuthConfigSchema,
    OrchidToolConfigSchema,
    OrchidMCPGatewayConfigSchema,
    OrchidMCPGatewayPromptSchema,
} from "../../src/config/schema/index.js";

describe("Config Schema - MCP", () => {
    it("parses MCP auth config with defaults", () => {
        const result = OrchidMCPAuthConfigSchema.parse({});
        expect(result.mode).toBe("none");
    });

    it("parses MCP auth config with oauth mode", () => {
        const result = OrchidMCPAuthConfigSchema.parse({ mode: "oauth" });
        expect(result.mode).toBe("oauth");
    });

    it("rejects invalid auth mode", () => {
        expect(() => OrchidMCPAuthConfigSchema.parse({ mode: "invalid" })).toThrow();
    });

    it("parses tool config with defaults", () => {
        const result = OrchidToolConfigSchema.parse({ name: "search" });
        expect(result.name).toBe("search");
        expect(result.injectToRag).toBe(false);
        expect(result.requiresApproval).toBe(false);
        expect(result.parallelSafe).toBeNull();
        expect(result.rag).toBeNull();
    });

    it("parses MCP server config", () => {
        const result = OrchidMCPServerConfigSchema.parse({
            name: "test-server",
            url: "http://localhost:3001/mcp",
            tools: [{ name: "search" }],
        });
        expect(result.name).toBe("test-server");
        expect(result.url).toBe("http://localhost:3001/mcp");
        expect(result.tools).toHaveLength(1);
        expect(result.type).toBe("local");
        expect(result.transport).toBe("streamable_http");
    });

    it("handles wildcard tools (normalized to empty)", () => {
        const result = OrchidMCPServerConfigSchema.parse({
            name: "test-server",
            url: "http://localhost/mcp",
            tools: "*",
        });
        expect(result.tools).toEqual([]);
    });

    it("rejects unknown fields", () => {
        expect(() =>
            OrchidMCPServerConfigSchema.parse({
                name: "test",
                url: "http://localhost/mcp",
                unknown_field: "nope",
            }),
        ).toThrow();
    });
});

describe("Config Schema - MCP Gateway", () => {
    it("parses empty gateway config", () => {
        const result = OrchidMCPGatewayConfigSchema.parse({});
        expect(result.tools).toEqual({});
        expect(result.prompts).toEqual([]);
    });

    it("parses tool overrides", () => {
        const result = OrchidMCPGatewayConfigSchema.parse({
            tools: {
                orchid_ask: { title: "Ask KB", description: "Route questions" },
            },
        });
        expect(result.tools.orchid_ask.title).toBe("Ask KB");
        expect(result.tools.orchid_ask.description).toBe("Route questions");
    });

    it("parses prompts", () => {
        const result = OrchidMCPGatewayConfigSchema.parse({
            prompts: [
                {
                    name: "compliance_report",
                    description: "Generate a report",
                    template: "Report for {{department}}",
                    arguments: [{ name: "department", required: true }],
                },
            ],
        });
        expect(result.prompts).toHaveLength(1);
        expect(result.prompts[0].name).toBe("compliance_report");
        expect(result.prompts[0].arguments[0].name).toBe("department");
    });

    it("rejects duplicate prompt names", () => {
        expect(() =>
            OrchidMacPGatewayConfigSchema.parse({
                prompts: [
                    { name: "test", template: "foo" },
                    { name: "test", template: "bar" },
                ],
            }),
        ).toThrow();
    });

    it("validates prompt name format", () => {
        const result = OrchidMCPGatewayPromptSchema.parse({
            name: "valid_name-1",
            template: "Hello {{who}}",
        });
        expect(result.name).toBe("valid_name-1");
    });

    it("rejects invalid prompt name", () => {
        expect(() =>
            OrchidMCPGatewayPromptSchema.parse({
                name: "1-invalid",
                template: "Hello",
            }),
        ).toThrow();
    });
});
