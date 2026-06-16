import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPToolWrapper, BuiltinToolWrapper, buildLangChainTools } from "../../src/agents/tools.js";
import { OrchidAuthContext } from "../../src/core/state.js";
import { OrchidMCPToolResult } from "../../src/core/mcpResult.js";
import { OrchidTool, OrchidToolInput, OrchidToolOutput } from "../../src/core/tool.js";
import { TOOL_REGISTRY } from "../../src/config/toolRegistry.js";

function makeAuth(): OrchidAuthContext {
    return new OrchidAuthContext({ accessToken: "test-token" });
}

describe("MCPToolWrapper", () => {
    let auth: OrchidAuthContext;
    let mcpClient: { callTool: ReturnType<typeof vi.fn>; serverUrl: string };

    beforeEach(() => {
        auth = makeAuth();
        mcpClient = {
            callTool: vi
                .fn()
                .mockResolvedValue(new OrchidMCPToolResult([{ type: "text", text: "mcp result" }])),
            serverUrl: "https://mcp.example.com",
        };
    });

    it("constructs with correct properties", () => {
        const wrapper = new MCPToolWrapper({
            name: "my_tool",
            description: "Does something",
            mcpClient: mcpClient as any,
            auth,
        });

        expect(wrapper.name).toBe("my_tool");
        expect(wrapper.description).toBe("Does something");
        expect(wrapper.requiresApproval).toBe(false);
    });

    it("constructs with requiresApproval = true", () => {
        const wrapper = new MCPToolWrapper({
            name: "approve_tool",
            description: "Needs approval",
            mcpClient: mcpClient as any,
            auth,
            requiresApproval: true,
        });

        expect(wrapper.requiresApproval).toBe(true);
    });

    it("invoke calls mcpClient.callTool and returns text", async () => {
        const wrapper = new MCPToolWrapper({
            name: "my_tool",
            description: "desc",
            mcpClient: mcpClient as any,
            auth,
        });

        const result = await wrapper.invoke({ param1: "value1" });
        expect(mcpClient.callTool).toHaveBeenCalledWith("my_tool", { param1: "value1" }, auth);
        expect(result).toBe("mcp result");
    });

    it("returns [Tool error] prefix on isError result", async () => {
        mcpClient.callTool.mockResolvedValue(
            new OrchidMCPToolResult([{ type: "text", text: "something broke" }], true),
        );

        const wrapper = new MCPToolWrapper({
            name: "my_tool",
            description: "desc",
            mcpClient: mcpClient as any,
            auth,
        });

        const result = await wrapper.invoke({});
        expect(result).toBe("[Tool error] something broke");
    });

    it("returns [Tool error] on thrown exception", async () => {
        mcpClient.callTool.mockRejectedValue(new Error("network down"));

        const wrapper = new MCPToolWrapper({
            name: "my_tool",
            description: "desc",
            mcpClient: mcpClient as any,
            auth,
        });

        const result = await wrapper.invoke({});
        // The error is caught and wrapped with [Tool error] prefix
        expect(result).toContain("[Tool error]");
        expect(result).toContain("network down");
    });

    it("includes agentName for logging context", async () => {
        const wrapper = new MCPToolWrapper({
            name: "t",
            description: "d",
            mcpClient: mcpClient as any,
            auth,
            agentName: "test_agent",
        });

        await wrapper.invoke({});
        expect(mcpClient.callTool).toHaveBeenCalled();
    });
});

describe("BuiltinToolWrapper", () => {
    let auth: OrchidAuthContext;

    beforeEach(() => {
        auth = makeAuth();
        TOOL_REGISTRY.clear();
    });

    it("constructs with correct properties", () => {
        const wrapper = new BuiltinToolWrapper({
            name: "builtin_search",
            description: "Searches knowledge",
            auth,
        });

        expect(wrapper.name).toBe("builtin_search");
        expect(wrapper.description).toBe("Searches knowledge");
        expect(wrapper.requiresApproval).toBe(false);
    });

    it("invoke calls the registered built-in tool", async () => {
        const mockInvoke = vi.fn().mockResolvedValue(new OrchidToolOutput("search result"));

        class FakeTool extends OrchidTool {
            name = "builtin_search";
            description = "test";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return mockInvoke(_input);
            }
        }

        TOOL_REGISTRY.register(new FakeTool());

        const wrapper = new BuiltinToolWrapper({
            name: "builtin_search",
            description: "desc",
            auth,
        });

        const result = await wrapper.invoke({ query: "hello" });
        expect(result).toBe("search result");
        expect(mockInvoke).toHaveBeenCalledOnce();
    });

    it("returns [Tool error] when tool is not registered", async () => {
        const wrapper = new BuiltinToolWrapper({
            name: "nonexistent_tool",
            description: "desc",
            auth,
        });

        const result = await wrapper.invoke({});
        expect(result).toContain("[Tool error]");
    });

    it("returns [Tool error] when tool invoke throws", async () => {
        class FailingTool extends OrchidTool {
            name = "failing_tool";
            description = "test";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                throw new Error("invoke failed");
            }
        }

        TOOL_REGISTRY.register(new FailingTool());

        const wrapper = new BuiltinToolWrapper({
            name: "failing_tool",
            description: "desc",
            auth,
        });

        const result = await wrapper.invoke({});
        expect(result).toContain("[Tool error]");
        expect(result).toContain("invoke failed");
    });
});

describe("buildLangChainTools", () => {
    let auth: OrchidAuthContext;

    beforeEach(() => {
        auth = makeAuth();
        TOOL_REGISTRY.clear();
    });

    it("builds MCP tools from definitions", () => {
        const mockClient = {
            callTool: vi.fn(),
            serverUrl: "https://mcp.example.com",
        };

        const mcpToolClientMap = new Map([
            ["weather", { client: mockClient as any, serverConfig: {} }],
        ]);

        const tools = buildLangChainTools({
            builtinNames: new Set(),
            builtinToolDefs: [],
            mcpToolDefs: [{ function: { name: "weather", description: "Get weather" } }],
            mcpToolClientMap,
            auth,
        });

        expect(tools).toHaveLength(1);
        expect(tools[0]).toBeInstanceOf(MCPToolWrapper);
        expect(tools[0].name).toBe("weather");
    });

    it("builds built-in tools from definitions", () => {
        class FakeTool extends OrchidTool {
            name = "search";
            description = "search tool";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return new OrchidToolOutput("ok");
            }
        }
        TOOL_REGISTRY.register(new FakeTool());

        const tools = buildLangChainTools({
            builtinNames: new Set(["search"]),
            builtinToolDefs: [{ function: { name: "search", description: "Search" } }],
            mcpToolDefs: [],
            mcpToolClientMap: new Map(),
            auth,
        });

        expect(tools).toHaveLength(1);
        expect(tools[0]).toBeInstanceOf(BuiltinToolWrapper);
        expect(tools[0].name).toBe("search");
    });

    it("skips MCP tools without a matching client entry", () => {
        const tools = buildLangChainTools({
            builtinNames: new Set(),
            builtinToolDefs: [],
            mcpToolDefs: [{ function: { name: "missing_tool", description: "No client mapped" } }],
            mcpToolClientMap: new Map(),
            auth,
        });

        expect(tools).toHaveLength(0);
    });

    it("marks approval tools correctly", () => {
        const mockClient = {
            callTool: vi.fn(),
            serverUrl: "https://mcp.example.com",
        };
        const mcpToolClientMap = new Map([
            ["danger", { client: mockClient as any, serverConfig: {} }],
        ]);

        const tools = buildLangChainTools({
            builtinNames: new Set(),
            builtinToolDefs: [],
            mcpToolDefs: [{ function: { name: "danger", description: "Dangerous op" } }],
            mcpToolClientMap,
            auth,
            approvalTools: new Set(["danger"]),
        });

        expect(tools).toHaveLength(1);
        expect(tools[0].requiresApproval).toBe(true);
    });

    it("skips tool definitions with empty names", () => {
        const tools = buildLangChainTools({
            builtinNames: new Set(),
            builtinToolDefs: [{ function: { name: "", description: "No name" } }],
            mcpToolDefs: [{ function: {} }],
            mcpToolClientMap: new Map(),
            auth,
        });

        expect(tools).toHaveLength(0);
    });

    it("builds a mix of built-in and MCP tools", () => {
        class FakeTool extends OrchidTool {
            name = "search";
            description = "search tool";
            async invoke(_input: OrchidToolInput): Promise<OrchidToolOutput> {
                return new OrchidToolOutput("ok");
            }
        }
        TOOL_REGISTRY.register(new FakeTool());

        const mockClient = {
            callTool: vi.fn(),
            serverUrl: "https://mcp.example.com",
        };
        const mcpToolClientMap = new Map([
            ["weather", { client: mockClient as any, serverConfig: {} }],
        ]);

        const tools = buildLangChainTools({
            builtinNames: new Set(["search"]),
            builtinToolDefs: [{ function: { name: "search", description: "Search" } }],
            mcpToolDefs: [{ function: { name: "weather", description: "Get weather" } }],
            mcpToolClientMap,
            auth,
        });

        expect(tools).toHaveLength(2);
        const builtin = tools.filter((t) => t instanceof BuiltinToolWrapper);
        const mcp = tools.filter((t) => t instanceof MCPToolWrapper);
        expect(builtin).toHaveLength(1);
        expect(mcp).toHaveLength(1);
    });
});
