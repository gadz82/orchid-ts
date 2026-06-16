import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    CallAllStrategy,
    SequentialStrategy,
    LLMDecidesStrategy,
    registerStrategy,
    getStrategy,
    clearStrategies,
} from "../../src/agents/strategies.js";
import type { OrchidToolCallStrategy } from "../../src/agents/strategies.js";
import { OrchidAuthContext } from "../../src/core/state.js";
import { OrchidMCPToolResult } from "../../src/core/mcpResult.js";

function makeAuth(): OrchidAuthContext {
    return new OrchidAuthContext({ accessToken: "test-token", tenantKey: "t", userId: "u" });
}

function makeClient(
    callToolImpl?: (name: string, args: Record<string, unknown>) => Promise<OrchidMCPToolResult>,
) {
    const callTool =
        callToolImpl ?? (async () => new OrchidMCPToolResult([{ type: "text", text: "result" }]));
    return {
        callTool: vi.fn().mockImplementation(callTool),
        serverUrl: "https://example.com/mcp",
    };
}

const tools = [
    { name: "tool_a", arguments: { x: 1 } },
    { name: "tool_b", arguments: {} },
    { name: "tool_c", arguments: {} },
];

describe("CallAllStrategy", () => {
    let strategy: CallAllStrategy;
    let auth: OrchidAuthContext;

    beforeEach(() => {
        strategy = new CallAllStrategy();
        auth = makeAuth();
    });

    it("executes all tools concurrently and collects results", async () => {
        const client = makeClient();
        const results = await strategy.execute(client as any, tools, "hello", auth);

        expect(client.callTool).toHaveBeenCalledTimes(3);
        expect(client.callTool).toHaveBeenCalledWith("tool_a", { query: "hello", x: 1 }, auth);
        expect(client.callTool).toHaveBeenCalledWith("tool_b", { query: "hello" }, auth);
        expect(client.callTool).toHaveBeenCalledWith("tool_c", { query: "hello" }, auth);
        expect(results).toEqual({ tool_a: "result", tool_b: "result", tool_c: "result" });
    });

    it("returns error keys when tools fail", async () => {
        const client = makeClient(async (name) => {
            if (name === "tool_b") throw new Error("boom");
            return new OrchidMCPToolResult([{ type: "text", text: "ok" }]);
        });

        const results = await strategy.execute(client as any, [tools[0], tools[1]], "x", auth);

        expect(results).toHaveProperty("tool_a", "ok");
        expect(results).toHaveProperty("tool_b_error");
    });

    it("passes agentName from opts", async () => {
        const client = makeClient();
        await strategy.execute(client as any, [tools[0]], "q", auth, { agentName: "myagent" });
        expect(client.callTool).toHaveBeenCalledTimes(1);
    });

    it("returns empty object for empty tools list", async () => {
        const client = makeClient();
        const results = await strategy.execute(client as any, [], "q", auth);
        expect(results).toEqual({});
        expect(client.callTool).not.toHaveBeenCalled();
    });

    it("handles isError results from callTool", async () => {
        const client = makeClient(
            async () => new OrchidMCPToolResult([{ type: "text", text: "server error" }], true),
        );
        const results = await strategy.execute(client as any, [tools[0]], "q", auth);
        expect(results.tool_a).toBe("server error");
    });
});

describe("SequentialStrategy", () => {
    let strategy: SequentialStrategy;
    let auth: OrchidAuthContext;

    beforeEach(() => {
        strategy = new SequentialStrategy();
        auth = makeAuth();
    });

    it("chains previous_results through sequential tool calls", async () => {
        const client = makeClient();
        await strategy.execute(client as any, tools, "q", auth);

        expect(client.callTool).toHaveBeenCalledTimes(3);
        // First call: no previous_results
        const firstArgs = client.callTool.mock.calls[0][1];
        expect(firstArgs).not.toHaveProperty("previous_results");

        // Second call: includes tool_a result
        const secondArgs = client.callTool.mock.calls[1][1];
        expect(secondArgs).toHaveProperty("previous_results");
        expect(JSON.parse(secondArgs.previous_results as string)).toHaveProperty(
            "tool_a",
            "result",
        );

        // Third call: includes tool_a + tool_b results
        const thirdArgs = client.callTool.mock.calls[2][1];
        expect(JSON.parse(thirdArgs.previous_results as string)).toHaveProperty("tool_a", "result");
        expect(JSON.parse(thirdArgs.previous_results as string)).toHaveProperty("tool_b", "result");
    });

    it("continues after individual tool failures", async () => {
        const client = makeClient(async (name) => {
            if (name === "tool_a") throw new Error("fail");
            return new OrchidMCPToolResult([{ type: "text", text: `result-${name}` }]);
        });

        const results = await strategy.execute(client as any, tools, "q", auth);

        expect(results).toHaveProperty("tool_a_error");
        expect(results).toHaveProperty("tool_b", "result-tool_b");
        expect(results).toHaveProperty("tool_c", "result-tool_c");
    });

    it("returns empty object for empty tools list", async () => {
        const client = makeClient();
        const results = await strategy.execute(client as any, [], "q", auth);
        expect(results).toEqual({});
    });
});

describe("LLMDecidesStrategy", () => {
    let auth: OrchidAuthContext;

    beforeEach(() => {
        auth = makeAuth();
    });

    it("calls listTools when client supports it and uses discoverAllTools", async () => {
        const availableTools = [
            { name: "tool_a", description: "Tool A desc" },
            { name: "tool_b", description: "Tool B desc" },
        ];

        const mockChatModel = {
            ainvoke: vi.fn().mockResolvedValue({
                content: JSON.stringify([{ tool: "tool_a", arguments: { x: 1 } }]),
            }),
        };

        const client = {
            callTool: vi
                .fn()
                .mockResolvedValue(new OrchidMCPToolResult([{ type: "text", text: "result" }])),
            serverUrl: "https://x.com/mcp",
            listTools: vi.fn().mockResolvedValue(availableTools),
        };

        const strategy = new LLMDecidesStrategy();
        const results = await strategy.execute(
            client as any,
            [{ name: "tool_a", arguments: {} }],
            "query",
            auth,
            {
                agentName: "test",
                chatModel: mockChatModel as any,
                serverConfig: { discoverAllTools: true } as any,
            },
        );

        expect(client.listTools).toHaveBeenCalledWith(auth);
        expect(mockChatModel.ainvoke).toHaveBeenCalled();
        expect(client.callTool).toHaveBeenCalledWith("tool_a", { x: 1 }, auth);
        expect(results).toHaveProperty("tool_a", "result");
    });

    it("filters available tools by the whitelist when discoverAllTools is false", async () => {
        const availableTools = [
            { name: "tool_a", description: "A" },
            { name: "tool_b", description: "B" },
        ];

        const mockChatModel = {
            ainvoke: vi.fn().mockResolvedValue({
                content: JSON.stringify([{ tool: "tool_a", arguments: { arg: "val" } }]),
            }),
        };

        const client = {
            callTool: vi
                .fn()
                .mockResolvedValue(new OrchidMCPToolResult([{ type: "text", text: "ok" }])),
            serverUrl: "https://x.com/mcp",
            listTools: vi.fn().mockResolvedValue(availableTools),
        };

        const strategy = new LLMDecidesStrategy();
        const results = await strategy.execute(
            client as any,
            [{ name: "tool_a", arguments: {} }], // only tool_a whitelisted
            "q",
            auth,
            { agentName: "test", chatModel: mockChatModel as any, serverConfig: {} as any },
        );

        // The prompt should only include tool_a (the whitelisted one)
        const promptArg = mockChatModel.ainvoke.mock.calls[0][0];
        const promptStr = promptArg[0].content as string;
        expect(promptStr).toContain("tool_a");
        expect(promptStr).not.toContain("tool_b");

        expect(client.callTool).toHaveBeenCalledWith("tool_a", { arg: "val" }, auth);
        expect(results).toHaveProperty("tool_a", "ok");
    });

    it("falls back to all strategy when chatModel is not provided", async () => {
        const client = {
            callTool: vi
                .fn()
                .mockResolvedValue(
                    new OrchidMCPToolResult([{ type: "text", text: "fallback-ok" }]),
                ),
            serverUrl: "https://x.com/mcp",
            listTools: vi.fn().mockResolvedValue([{ name: "tool_a", description: "desc" }]),
        };

        const strategy = new LLMDecidesStrategy();
        const results = await strategy.execute(
            client as any,
            [{ name: "tool_a", arguments: {} }],
            "q",
            auth,
            { serverConfig: { discoverAllTools: true } as any },
        );

        expect(client.callTool).toHaveBeenCalledWith("tool_a", { query: "q" }, auth);
        expect(results).toHaveProperty("tool_a", "fallback-ok");
    });

    it("falls back to all strategy on invalid JSON response", async () => {
        const mockChatModel = {
            ainvoke: vi.fn().mockResolvedValue({ content: "not valid json {{{" }),
        };

        const client = {
            callTool: vi
                .fn()
                .mockResolvedValue(new OrchidMCPToolResult([{ type: "text", text: "fallback" }])),
            serverUrl: "https://x.com/mcp",
            listTools: vi.fn().mockResolvedValue([{ name: "tool_a", description: "desc" }]),
        };

        const strategy = new LLMDecidesStrategy();
        const results = await strategy.execute(
            client as any,
            [{ name: "tool_a", arguments: {} }],
            "q",
            auth,
            { chatModel: mockChatModel as any, serverConfig: { discoverAllTools: true } as any },
        );

        expect(client.callTool).toHaveBeenCalledWith("tool_a", { query: "q" }, auth);
        expect(results).toHaveProperty("tool_a", "fallback");
    });

    it("falls back to all strategy on LLM API error", async () => {
        const mockChatModel = {
            ainvoke: vi.fn().mockRejectedValue(new Error("API error")),
        };

        const client = {
            callTool: vi
                .fn()
                .mockResolvedValue(new OrchidMCPToolResult([{ type: "text", text: "fallback" }])),
            serverUrl: "https://x.com/mcp",
            listTools: vi.fn().mockResolvedValue([{ name: "tool_a", description: "desc" }]),
        };

        const strategy = new LLMDecidesStrategy();
        const results = await strategy.execute(
            client as any,
            [{ name: "tool_a", arguments: {} }],
            "q",
            auth,
            { chatModel: mockChatModel as any, serverConfig: { discoverAllTools: true } as any },
        );

        expect(client.callTool).toHaveBeenCalledWith("tool_a", { query: "q" }, auth);
        expect(results).toHaveProperty("tool_a", "fallback");
    });

    it("returns empty object when no tools are available", async () => {
        const client = {
            callTool: vi.fn(),
            serverUrl: "https://x.com/mcp",
            listTools: vi.fn().mockResolvedValue([]),
        };

        const strategy = new LLMDecidesStrategy();
        const results = await strategy.execute(
            client as any,
            [{ name: "tool_a", arguments: {} }],
            "q",
            auth,
        );

        expect(results).toEqual({});
        expect(client.callTool).not.toHaveBeenCalled();
    });
});

describe("Strategy Registry", () => {
    beforeEach(() => {
        clearStrategies();
    });

    it("returns CallAllStrategy for unknown strategy name (fallback)", () => {
        const strategy = getStrategy("nonexistent");
        expect(strategy).toBeInstanceOf(CallAllStrategy);
    });

    it("returns SequentialStrategy by name", () => {
        const strategy = getStrategy("sequential");
        expect(strategy).toBeInstanceOf(SequentialStrategy);
    });

    it("returns LLMDecidesStrategy by name", () => {
        const strategy = getStrategy("llm_decides");
        expect(strategy).toBeInstanceOf(LLMDecidesStrategy);
    });

    it("registers and retrieves a custom strategy", () => {
        class CustomStrategy implements OrchidToolCallStrategy {
            async execute(): Promise<Record<string, unknown>> {
                return { custom: true };
            }
        }
        registerStrategy("custom", CustomStrategy);
        const strategy = getStrategy("custom");
        expect(strategy).toBeInstanceOf(CustomStrategy);
    });

    it("clearStrategies resets to built-in only", () => {
        class CustomStrategy implements OrchidToolCallStrategy {
            async execute(): Promise<Record<string, unknown>> {
                return {};
            }
        }
        registerStrategy("custom", CustomStrategy);
        clearStrategies();
        expect(() => getStrategy("custom")).not.toThrow();
        expect(getStrategy("all")).toBeInstanceOf(CallAllStrategy);
    });
});
