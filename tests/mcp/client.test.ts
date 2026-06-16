import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamableHttpMCPClient } from "../../src/mcp/client.js";
import { OrchidAuthContext } from "../../src/core/state.js";
import { OrchidMCPToolResult } from "../../src/core/mcpResult.js";
import { OrchidMCPAuthRequiredError } from "../../src/core/mcpErrors.js";

function makeAuth(): OrchidAuthContext {
    return new OrchidAuthContext({ accessToken: "bearer-token", tenantKey: "t1", userId: "u1" });
}

function makeClient(opts: Record<string, unknown> = {}) {
    return new StreamableHttpMCPClient({
        url: (opts.url as string) ?? "http://localhost:9000/mcp",
        serverName: (opts.serverName as string) ?? "test-srv",
        authMode: (opts.authMode as string) ?? "none",
        tokenStore: (opts.tokenStore ?? null) as any,
        registrationStore: (opts.registrationStore ?? null) as any,
        allowedPassthroughHosts: (opts.allowedPassthroughHosts ?? []) as string[],
    });
}

// We test the public interface surface and auth header resolution indirectly.
// Real MCP transport is not instantiated — only the interface shape is verified.

describe("StreamableHttpMCPClient", () => {
    let auth: OrchidAuthContext;

    beforeEach(() => {
        auth = makeAuth();
    });

    describe("construction", () => {
        it("sets url from constructor", () => {
            const client = makeClient({ url: "http://localhost:9000" });
            expect(client.url).toBe("http://localhost:9000");
            expect(client.serverUrl).toBe("http://localhost:9000");
        });

        it("sets server name from constructor", () => {
            const client = makeClient({ serverName: "my-srv" });
            expect(client.serverName).toBe("my-srv");
        });

        it("sets defaults for missing options", () => {
            const client = makeClient();
            expect(client.serverType).toBe("local");
            expect(client.transportType).toBe("streamable_http");
            expect(client.authMode).toBe("none");
            expect(client.allowedPassthroughHosts).toEqual([]);
        });

        it("maps auth mode strings", () => {
            expect(makeClient({ authMode: "passthrough" }).authMode).toBe("passthrough");
            expect(makeClient({ authMode: "oauth" }).authMode).toBe("oauth");
            expect(makeClient({ authMode: "invalid" }).authMode).toBe("none");
        });
    });

    describe("cache state", () => {
        it("starts with cold cache", () => {
            const client = makeClient();
            expect(client.isCacheWarm).toBe(false);
            expect(client.cachedTools).toEqual([]);
            expect(client.cachedPrompts).toEqual([]);
            expect(client.cachedResources).toEqual([]);
        });

        it("invalidateCache clears cache state", () => {
            const client = makeClient();
            client.invalidateCache();
            expect(client.isCacheWarm).toBe(false);
        });
    });

    describe("callTool", () => {
        it("calls tool and returns OrchidMCPToolResult", async () => {
            const mockMCPClient = {
                connect: vi.fn().mockResolvedValue(undefined),
                callTool: vi.fn().mockResolvedValue({
                    content: [{ type: "text", text: "tool output" }],
                    isError: false,
                }),
                listTools: vi.fn().mockResolvedValue({ tools: [] }),
                listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
                listResources: vi.fn().mockResolvedValue({ resources: [] }),
            };

            const client = makeClient({ authMode: "none" });
            // Patch private methods to skip real transport
            (client as any).client = mockMCPClient;
            (client as any).connected = true;
            (client as any).lastAuthSig = "none";

            const result = await client.callTool("testTool", { param: "val" }, auth);
            expect(result).toBeInstanceOf(OrchidMCPToolResult);
            expect(mockMCPClient.callTool).toHaveBeenCalledWith({
                name: "testTool",
                arguments: { param: "val" },
            });
        });

        it("returns error result on tool call failure", async () => {
            const mockMCPClient = {
                connect: vi.fn().mockResolvedValue(undefined),
                callTool: vi.fn().mockRejectedValue(new Error("connection lost")),
                listTools: vi.fn().mockResolvedValue({ tools: [] }),
                listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
                listResources: vi.fn().mockResolvedValue({ resources: [] }),
            };

            const client = makeClient();
            (client as any).client = mockMCPClient;
            (client as any).connected = true;
            (client as any).lastAuthSig = "none";

            const result = await client.callTool("testTool", {}, auth);
            expect(result.isError).toBe(true);
        });

        it("re-throws OrchidMCPAuthRequiredError", async () => {
            const mockMCPClient = {
                connect: vi.fn().mockResolvedValue(undefined),
                callTool: vi.fn().mockRejectedValue(new OrchidMCPAuthRequiredError("srv")),
                listTools: vi.fn().mockResolvedValue({ tools: [] }),
                listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
                listResources: vi.fn().mockResolvedValue({ resources: [] }),
            };

            const client = makeClient();
            (client as any).client = mockMCPClient;
            (client as any).connected = true;
            (client as any).lastAuthSig = "none";

            await expect(client.callTool("t", {}, auth)).rejects.toThrow(
                OrchidMCPAuthRequiredError,
            );
        });
    });

    describe("discovery methods", () => {
        it("listTools returns tools from MCP client", async () => {
            const mockMCPClient = {
                connect: vi.fn().mockResolvedValue(undefined),
                callTool: vi.fn(),
                listTools: vi.fn().mockResolvedValue({
                    tools: [{ name: "t1", description: "Tool 1" }],
                }),
            };

            const client = makeClient();
            (client as any).client = mockMCPClient;
            (client as any).connected = true;
            (client as any).lastAuthSig = "none";

            const tools = await client.listTools(auth);
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe("t1");
        });

        it("listTools returns empty array on error", async () => {
            const mockMCPClient = {
                connect: vi.fn().mockResolvedValue(undefined),
                callTool: vi.fn(),
                listTools: vi.fn().mockRejectedValue(new Error("fail")),
            };

            const client = makeClient();
            (client as any).client = mockMCPClient;
            (client as any).connected = true;
            (client as any).lastAuthSig = "none";

            const tools = await client.listTools(auth);
            expect(tools).toEqual([]);
        });

        it("listPrompts returns prompts", async () => {
            const mockMCPClient = {
                connect: vi.fn().mockResolvedValue(undefined),
                listPrompts: vi.fn().mockResolvedValue({
                    prompts: [{ name: "p1", description: "Prompt 1" }],
                }),
            };

            const client = makeClient();
            (client as any).client = mockMCPClient;
            (client as any).connected = true;
            (client as any).lastAuthSig = "none";

            const prompts = await client.listPrompts(auth);
            expect(prompts).toHaveLength(1);
        });

        it("listResources returns resources", async () => {
            const mockMCPClient = {
                connect: vi.fn().mockResolvedValue(undefined),
                listResources: vi.fn().mockResolvedValue({
                    resources: [{ uri: "file:///data.txt", name: "Data" }],
                }),
            };

            const client = makeClient();
            (client as any).client = mockMCPClient;
            (client as any).connected = true;
            (client as any).lastAuthSig = "none";

            const resources = await client.listResources(auth);
            expect(resources).toHaveLength(1);
        });
    });

    describe("close", () => {
        it("clears cache and disconnects", async () => {
            const client = makeClient();
            const transport = { close: vi.fn().mockResolvedValue(undefined) };
            (client as any).transport = transport;
            (client as any).client = {};
            (client as any).connected = true;

            await client.close();
            expect(client.isCacheWarm).toBe(false);
            expect(transport.close).toHaveBeenCalled();
        });
    });
});
