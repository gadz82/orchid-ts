import { describe, it, expect, beforeEach } from "vitest";
import { toolsToLiteLLMFormat, resolveParallelSafety } from "../../src/agents/toolUtils.js";
import type { MCPCapabilities } from "../../src/agents/mcpDispatcher.js";
import { MCPToolAnnotations } from "../../src/agents/mcpDispatcher.js";
import { OrchidTool, OrchidToolInput, OrchidToolOutput } from "../../src/core/tool.js";
import { TOOL_REGISTRY } from "../../src/config/toolRegistry.js";

function makeCaps(toolAnnotations?: Map<string, MCPToolAnnotations>): MCPCapabilities {
    return {
        rawTools: [],
        toolClientMap: new Map(),
        toolAnnotations: toolAnnotations ?? new Map(),
        renderedPrompts: [],
        resourceContents: new Map(),
        skippedPrompts: [],
    };
}

describe("toolsToLiteLLMFormat", () => {
    beforeEach(() => {
        TOOL_REGISTRY.clear();
    });

    it("converts registered tools to LLM schema format", () => {
        class ToolA extends OrchidTool {
            name = "search";
            description = "Search tool";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return new OrchidToolOutput("ok");
            }
        }
        TOOL_REGISTRY.register(new ToolA());

        const result = toolsToLiteLLMFormat(["search"]);
        expect(result.names).toContain("search");
        expect(result.names.size).toBe(1);
        expect(result.defs).toHaveLength(1);
        expect(result.defs[0]).toHaveProperty("type", "function");
        expect((result.defs[0] as any).function.name).toBe("search");
    });

    it("skips tools in the skipTools set", () => {
        class ToolA extends OrchidTool {
            name = "search";
            description = "Search tool";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return new OrchidToolOutput("ok");
            }
        }
        TOOL_REGISTRY.register(new ToolA());

        const result = toolsToLiteLLMFormat(["search"], { skipTools: new Set(["search"]) });
        expect(result.names.size).toBe(0);
        expect(result.defs).toHaveLength(0);
    });

    it("skips tools with builtin_ prefix in skipTools", () => {
        class ToolA extends OrchidTool {
            name = "search";
            description = "Search tool";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return new OrchidToolOutput("ok");
            }
        }
        TOOL_REGISTRY.register(new ToolA());

        const result = toolsToLiteLLMFormat(["search"], { skipTools: new Set(["builtin_search"]) });
        expect(result.names.size).toBe(0);
        expect(result.defs).toHaveLength(0);
    });

    it("ignores unregistered tool names gracefully", () => {
        const result = toolsToLiteLLMFormat(["nonexistent"]);
        expect(result.names.size).toBe(0);
        expect(result.defs).toHaveLength(0);
    });

    it("handles multiple tools with some skipped", () => {
        class ToolA extends OrchidTool {
            name = "search";
            description = "Search";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return new OrchidToolOutput("ok");
            }
        }
        class ToolB extends OrchidTool {
            name = "analyze";
            description = "Analyze";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return new OrchidToolOutput("ok");
            }
        }
        TOOL_REGISTRY.register(new ToolA());
        TOOL_REGISTRY.register(new ToolB());

        const result = toolsToLiteLLMFormat(["search", "analyze"], {
            skipTools: new Set(["analyze"]),
        });
        expect(result.names).toEqual(new Set(["search"]));
        expect(result.defs).toHaveLength(1);
        expect((result.defs[0] as any).function.name).toBe("search");
    });
});

describe("resolveParallelSafety", () => {
    it("returns null when parallelToolsEnabled is false", () => {
        const result = resolveParallelSafety({
            toolMap: {},
            builtinToolNames: new Set(),
            caps: null,
            parallelToolsEnabled: false,
        });
        expect(result).toBeNull();
    });

    it("marks approval tools as not parallel-safe", () => {
        const result = resolveParallelSafety({
            toolMap: { danger: {} },
            builtinToolNames: new Set(),
            caps: null,
            parallelToolsEnabled: true,
            approvalTools: new Set(["danger"]),
        });
        expect(result).toEqual({ danger: false });
    });

    it("uses parallelSafeBuiltinTools for built-in tools", () => {
        const result = resolveParallelSafety({
            toolMap: { search: {} },
            builtinToolNames: new Set(["search"]),
            caps: null,
            parallelToolsEnabled: true,
            parallelSafeBuiltinTools: new Set(["search"]),
        });
        expect(result).toEqual({ search: true });
    });

    it("marks non-safe builtin as false", () => {
        const result = resolveParallelSafety({
            toolMap: { mutate: {} },
            builtinToolNames: new Set(["mutate"]),
            caps: null,
            parallelToolsEnabled: true,
            parallelSafeBuiltinTools: new Set(["search"]), // mutate not in safe set
        });
        expect(result).toEqual({ mutate: false });
    });

    it("uses MCP parallel overrides", () => {
        const result = resolveParallelSafety({
            toolMap: { mcp_tool: {} },
            builtinToolNames: new Set(),
            caps: makeCaps(),
            parallelToolsEnabled: true,
            mcpParallelOverrides: { mcp_tool: true },
        });
        expect(result).toEqual({ mcp_tool: true });
    });

    it("uses readOnlyHint annotation for MCP tools", () => {
        const annotations = new Map([
            ["readonly_tool", new MCPToolAnnotations({ readOnlyHint: true })],
            ["write_tool", new MCPToolAnnotations({ readOnlyHint: false })],
        ]);

        const result = resolveParallelSafety({
            toolMap: { readonly_tool: {}, write_tool: {} },
            builtinToolNames: new Set(),
            caps: makeCaps(annotations),
            parallelToolsEnabled: true,
        });
        expect(result).toEqual({ readonly_tool: true, write_tool: false });
    });

    it("works with Map toolMap", () => {
        const toolMap = new Map([
            ["tool1", {}],
            ["tool2", {}],
        ]);

        const result = resolveParallelSafety({
            toolMap: toolMap as any,
            builtinToolNames: new Set(),
            caps: null,
            parallelToolsEnabled: true,
            approvalTools: new Set(),
        });
        // No annotations, no overrides -> defaults to false
        expect(result).toEqual({ tool1: false, tool2: false });
    });

    it("approval takes priority over other safety checks", () => {
        const annotations = new Map([["tool", new MCPToolAnnotations({ readOnlyHint: true })]]);

        const result = resolveParallelSafety({
            toolMap: { tool: {} },
            builtinToolNames: new Set(),
            caps: makeCaps(annotations),
            parallelToolsEnabled: true,
            approvalTools: new Set(["tool"]),
            mcpParallelOverrides: { tool: true },
        });

        // Approval check runs first and marks it false regardless of overrides
        expect(result).toEqual({ tool: false });
    });
});
