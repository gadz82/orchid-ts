import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/loader.js", () => ({
    loadConfig: vi.fn().mockResolvedValue({ agents: {} }),
}));

vi.mock("../../src/graph/builder.js", () => ({
    buildGraph: vi.fn().mockResolvedValue({ name: "mockGraph" }),
}));

vi.mock("../../src/checkpointing/factory.js", () => ({
    shutdownCheckpointer: vi.fn().mockResolvedValue(undefined),
}));

import {
    Orchid,
    OrchidRuntime,
    OrchidInvokeResult,
    OrchidPendingApproval,
} from "../../src/orchid/orchid.js";

function makeRuntime() {
    return new OrchidRuntime({ defaultModel: "test-model", chatStorage: { close: vi.fn() } });
}

describe("Orchid facade", () => {
    describe("fromConfig", () => {
        it("creates an instance from a config object", async () => {
            const config = { agents: {}, supervisor: {} };
            const orchid = await Orchid.fromConfig(config, { defaultModel: "test-model" });
            expect(orchid).toBeInstanceOf(Orchid);
            expect(orchid.runtime).toBeInstanceOf(OrchidRuntime);
            expect(orchid.runtime.defaultModel).toBe("test-model");
        });

        it("accepts runtime overrides", async () => {
            const config = { agents: {} };
            const orchid = await Orchid.fromConfig(config, { defaultModel: "custom-model" });
            expect(orchid.runtime.defaultModel).toBe("custom-model");
        });
    });

    describe("fromConfigPath", () => {
        it("creates an instance from a config file path", async () => {
            const orchid = await Orchid.fromConfigPath("/fake/path.yaml");
            expect(orchid).toBeInstanceOf(Orchid);
        });

        it("accepts overrides with model override", async () => {
            const overrides = { model: "openai/gpt-4o" };
            const orchid = await Orchid.fromConfigPath("/fake/path.yaml", overrides);
            expect(orchid.runtime.defaultModel).toBe("openai/gpt-4o");
        });
    });

    describe("invoke", () => {
        it("throws when instance is closed", async () => {
            const orchid = new Orchid({ runtime: makeRuntime() });
            await orchid.close();
            await expect(
                orchid.invoke({
                    messages: [{ type: "human", content: "hi" }],
                    chatId: "c1",
                    activeAgents: [],
                    mcpContext: {},
                    ragContext: {},
                    finalResponse: null,
                    skillInstructions: {},
                    _hasOutputGuardrails: false,
                }),
            ).rejects.toThrow("Orchid instance has been closed");
        });

        it("delegates to the invoker when open", async () => {
            const graph = {
                invoke: vi
                    .fn()
                    .mockResolvedValue({ messages: [{ type: "ai", content: "hello" }] }),
            };
            const orchid = new Orchid({ runtime: makeRuntime(), graph });
            const result = await orchid.invoke(
                {
                    messages: [{ type: "human", content: "hi" }],
                    chatId: "c1",
                    activeAgents: [],
                    mcpContext: {},
                    ragContext: {},
                    finalResponse: null,
                    skillInstructions: {},
                    _hasOutputGuardrails: false,
                },
                { configurable: { thread_id: "t1", auth_context: null } },
            );
            expect(result).toBeInstanceOf(OrchidInvokeResult);
            expect(result.response).toBe("hello");
        });
    });

    describe("stream", () => {
        it("throws when instance is closed", async () => {
            const orchid = new Orchid({ runtime: makeRuntime() });
            await orchid.close();
            await expect(
                orchid.stream({
                    messages: [{ type: "human", content: "hi" }],
                    chatId: "c1",
                    activeAgents: [],
                    mcpContext: {},
                    ragContext: {},
                    finalResponse: null,
                    skillInstructions: {},
                    _hasOutputGuardrails: false,
                }),
            ).rejects.toThrow("Orchid instance has been closed");
        });

        it("delegates to invoker stream when open", async () => {
            async function* fakeStream() {
                yield ["updates", { messages: [] }];
            }
            const graph = { stream: vi.fn().mockImplementation(() => fakeStream()) };
            const orchid = new Orchid({ runtime: makeRuntime(), graph });
            const iter = await orchid.stream(
                {
                    messages: [{ type: "human", content: "hi" }],
                    chatId: "c1",
                    activeAgents: [],
                    mcpContext: {},
                    ragContext: {},
                    finalResponse: null,
                    skillInstructions: {},
                    _hasOutputGuardrails: false,
                },
                { configurable: { thread_id: "t1" } },
            );
            const events: any[] = [];
            for await (const e of iter) events.push(e);
            expect(events.length).toBe(1);
        });
    });

    describe("resume", () => {
        it("throws when instance is closed", async () => {
            const orchid = new Orchid({ runtime: makeRuntime() });
            await orchid.close();
            await expect(
                orchid.resume("t1", { tool: "do", args: {}, agent: "a", approved: true }),
            ).rejects.toThrow("Orchid instance has been closed");
        });

        it("delegates to invoker resume when open", async () => {
            const graph = {
                invoke: vi
                    .fn()
                    .mockResolvedValue({ messages: [{ type: "ai", content: "resumed" }] }),
            };
            const rt = makeRuntime();
            rt.checkpointer = { get: vi.fn(), put: vi.fn() };
            const orchid = new Orchid({ runtime: rt, graph });
            const result = await orchid.resume(
                "t1",
                { tool: "do", args: {}, agent: "a", approved: true },
                { configurable: { auth_context: null } },
            );
            expect(result).toBeInstanceOf(OrchidInvokeResult);
            expect(result.response).toBe("resumed");
        });
    });

    describe("close", () => {
        it("marks the instance as closed", async () => {
            const orchid = new Orchid({ runtime: makeRuntime() });
            await orchid.close();
            await expect(
                orchid.invoke({
                    messages: [],
                    chatId: "c1",
                    activeAgents: [],
                    mcpContext: {},
                    ragContext: {},
                    finalResponse: null,
                    skillInstructions: {},
                    _hasOutputGuardrails: false,
                }),
            ).rejects.toThrow("Orchid instance has been closed");
        });

        it("is idempotent", async () => {
            const orchid = new Orchid({ runtime: makeRuntime() });
            await orchid.close();
            await orchid.close();
            // should not throw
        });
    });

    describe("accessors", () => {
        it("chatStorage returns runtime chat storage", () => {
            const rt = makeRuntime();
            rt.chatStorage = { db: "mock" };
            const orchid = new Orchid({ runtime: rt });
            expect(orchid.chatStorage).toEqual({ db: "mock" });
        });

        it("reader returns runtime reader", () => {
            const rt = makeRuntime();
            rt.reader = { retrieve: vi.fn() };
            const orchid = new Orchid({ runtime: rt });
            expect(orchid.reader).toBe(rt.reader);
        });

        it("runtime returns the OrchidRuntime", () => {
            const rt = makeRuntime();
            const orchid = new Orchid({ runtime: rt });
            expect(orchid.runtime).toBe(rt);
            expect(orchid.runtime).toBeInstanceOf(OrchidRuntime);
        });

        it("graph returns the compiled graph", () => {
            const g = { name: "mockGraph" };
            const orchid = new Orchid({ runtime: makeRuntime(), graph: g });
            expect(orchid.graph).toBe(g);
        });
    });
});
