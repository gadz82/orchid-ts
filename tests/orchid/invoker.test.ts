import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    OrchidInvoker,
    OrchidInvokeResult,
    OrchidPendingApproval,
} from "../../src/orchid/invoker.js";
import { GraphInterrupt } from "../../src/core/index.js";

function mockChatRepo() {
    return {
        addMessage: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockCheckpointer() {
    return { get: vi.fn(), put: vi.fn() };
}

describe("OrchidInvoker", () => {
    let graph: any;
    let invoker: OrchidInvoker;

    beforeEach(() => {
        graph = {
            invoke: vi.fn().mockResolvedValue({ messages: [{ type: "ai", content: "Hello!" }] }),
            stream: vi.fn().mockImplementation(async function* () {
                yield ["updates", { agent: { messages: [] } }];
            }),
        };
        invoker = new OrchidInvoker({ graph });
    });

    describe("invoke", () => {
        it("calls graph.invoke and returns a result", async () => {
            const result = await invoker.invoke({ message: "Hello" });
            expect(result).toBeInstanceOf(OrchidInvokeResult);
            expect(result.response).toBe("Hello!");
            expect(result.chatId).toBeTruthy();
        });

        it("uses provided chatId", async () => {
            const result = await invoker.invoke({ message: "Hello", chatId: "my-chat" });
            expect(result.chatId).toBe("my-chat");
        });

        it("persists messages when chatRepo is provided and persist is not false", async () => {
            const repo = mockChatRepo();
            const inv = new OrchidInvoker({ graph, chatRepo: repo });
            await inv.invoke({ message: "Hello", chatId: "c1", persist: true });
            expect(repo.addMessage).toHaveBeenCalled();
        });

        it("does not persist when persist is false", async () => {
            const repo = mockChatRepo();
            const inv = new OrchidInvoker({ graph, chatRepo: repo });
            await inv.invoke({ message: "Hello", chatId: "c1", persist: false });
            expect(repo.addMessage).not.toHaveBeenCalled();
        });

        it("returns interrupted result for GraphInterrupt", async () => {
            const interrupt = new GraphInterrupt({
                toolName: "dangerous",
                arguments: { x: 1 },
                agentName: "test",
            });
            graph.invoke.mockRejectedValueOnce(interrupt);
            const result = await invoker.invoke({ message: "Hello", chatId: "c1" });
            expect(result).toBeInstanceOf(OrchidInvokeResult);
            expect(result.interrupted).toBe(true);
        });

        it("handles interrupt from raw tool_approval exception", async () => {
            graph.invoke.mockRejectedValueOnce({
                type: "tool_approval",
                tool: "raw",
                args: {},
                agent: "a",
            });
            const result = await invoker.invoke({ message: "Hello", chatId: "c1" });
            expect(result.interrupted).toBe(true);
        });

        it("re-throws unknown errors", async () => {
            graph.invoke.mockRejectedValueOnce(new Error("boom"));
            await expect(invoker.invoke({ message: "Hello" })).rejects.toThrow("boom");
        });
    });

    describe("resume", () => {
        it("throws without checkpointer", async () => {
            await expect(invoker.resume({ chatId: "c1" })).rejects.toThrow(
                "no checkpointer configured",
            );
        });

        it("calls graph.invoke with resume command", async () => {
            const ch = mockCheckpointer();
            const inv = new OrchidInvoker({ graph, checkpointer: ch });
            const result = await inv.resume({ chatId: "c1" });
            expect(result).toBeInstanceOf(OrchidInvokeResult);
        });

        it("passes approved flag through command", async () => {
            const ch = mockCheckpointer();
            const inv = new OrchidInvoker({ graph, checkpointer: ch });
            graph.invoke.mockResolvedValueOnce({
                messages: [{ type: "ai", content: "approved!" }],
            });
            await inv.resume({ chatId: "c1", approved: false });
            const callArgs = graph.invoke.mock.calls[0];
            expect(callArgs[0].resume.approved).toBe(false);
        });
    });

    describe("stream", () => {
        it("returns an async iterable", async () => {
            const iterable = await invoker.stream({ message: "Hello" });
            expect(iterable).toBeDefined();
            const events: any[] = [];
            for await (const e of iterable) events.push(e);
            expect(events.length).toBe(1);
        });

        it("passes streamMode to graph.stream", async () => {
            await invoker.stream({ message: "Hello", streamMode: "messages" });
            const callArgs = graph.stream.mock.calls[0];
            expect(callArgs[1].streamMode).toBe("messages");
        });
    });

    describe("prepareInvocation", () => {
        it("builds state with user message as human type", async () => {
            graph.invoke.mockImplementation(async (state: any) => {
                expect(state.messages.length).toBeGreaterThanOrEqual(1);
                expect(state.messages[0].type).toBe("human");
                expect(state.messages[0].content).toBe("test message");
                return { messages: [{ type: "ai", content: "ok" }] };
            });
            await invoker.invoke({ message: "test message" });
        });

        it("includes history messages", async () => {
            graph.invoke.mockImplementation(async (state: any) => {
                expect(state.messages).toHaveLength(3);
                expect(state.messages[0].type).toBe("human");
                expect(state.messages[0].content).toBe("history msg");
                return { messages: [{ type: "ai", content: "ok" }] };
            });
            await invoker.invoke({
                message: "current msg",
                history: [
                    { type: "human", content: "history msg" },
                    { type: "ai", content: "old reply" },
                ],
            });
        });
    });

    describe("OrchidPendingApproval", () => {
        it("constructs with tool, args, agent", () => {
            const approval = new OrchidPendingApproval({
                tool: "test_tool",
                args: { key: "val" },
                agent: "test_agent",
                interruptId: "int-1",
            });
            expect(approval.tool).toBe("test_tool");
            expect(approval.args).toEqual({ key: "val" });
            expect(approval.agent).toBe("test_agent");
            expect(approval.interruptId).toBe("int-1");
        });
    });

    describe("OrchidInvokeResult", () => {
        it("defaults to empty values", () => {
            const r = new OrchidInvokeResult();
            expect(r.response).toBe("");
            expect(r.chatId).toBe("");
            expect(r.interrupted).toBe(false);
            expect(r.approvalsNeeded).toEqual([]);
        });

        it("accepts field overrides", () => {
            const r = new OrchidInvokeResult({ response: "hi", chatId: "c1" });
            expect(r.response).toBe("hi");
            expect(r.chatId).toBe("c1");
        });
    });
});
