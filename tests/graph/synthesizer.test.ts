import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResponseSynthesizer, SYNTHESIS_SYSTEM_PROMPT } from "../../src/graph/synthesizer.js";
import type { GraphState } from "../../src/graph/state.js";
import { OrchidAuthContext } from "../../src/core/state.js";
import { OrchidConversationMemory } from "../../src/core/memory.js";

function state(overrides?: Partial<GraphState>): GraphState {
    return {
        messages: [],
        activeAgents: [],
        pendingAgents: [],
        ...overrides,
    };
}

function makeChatModel(content = "synthesised response") {
    return {
        invoke: vi.fn().mockResolvedValue({ content }),
        withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ content }),
            invoke: vi.fn().mockResolvedValue({ content }),
        }),
    };
}

function mockMemory() {
    return {
        getRunningSummary: vi.fn().mockResolvedValue(null),
        updateRunningSummary: vi.fn().mockResolvedValue(undefined),
        storeConversationTurn: vi.fn().mockResolvedValue(undefined),
        strategy: "none",
        storeTurns: false,
    } as unknown as OrchidConversationMemory;
}

describe("ResponseSynthesizer", () => {
    let chatModel: ReturnType<typeof makeChatModel>;
    let supConfig: any;

    beforeEach(() => {
        chatModel = makeChatModel();
        supConfig = {
            assistantName: "Orchid",
            historyMaxTurns: 20,
            historyMaxChars: 1000,
            historySummaryEnabled: false,
            historySummaryRecentTurns: 10,
            memory: { strategy: "none", structuredOutput: false },
        };
    });

    describe("single-agent fast path", () => {
        it("returns null when skipSynthesisWhenSingleAgent is false", () => {
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: false },
                chatModel: null,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nThe menu has 3 items" },
                ],
            });
            expect(s.trySingleAgentFastPath(st)).toBeNull();
        });

        it("returns fast-path result when single agent output and skip enabled", () => {
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: true },
                chatModel: null,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nThe menu has 3 items" },
                ],
            });
            const result = s.trySingleAgentFastPath(st);
            expect(result).not.toBeNull();
            expect(result!.finalResponse).toBe("The menu has 3 items");
            expect(result!.activeAgents).toEqual([]);
            expect(result!.pendingAgents).toEqual([]);
        });

        it("returns null when multiple agents present", () => {
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: true },
                chatModel: null,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nMenu data" },
                    { type: "ai", content: "[orders Agent]\nOrder data" },
                ],
            });
            expect(s.trySingleAgentFastPath(st)).toBeNull();
        });
    });

    describe("synthesise", () => {
        it("uses fast path when applicable", async () => {
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: true },
                chatModel,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nMenu is ready" },
                ],
            });
            const result = await s.synthesise(st);
            expect(result.finalResponse).toBe("Menu is ready");
            expect(chatModel.invoke).not.toHaveBeenCalled();
        });

        it("uses LLM synthesis path when multiple agents", async () => {
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: false },
                chatModel,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nMenu data" },
                    { type: "ai", content: "[orders Agent]\nOrder data" },
                ],
            });
            const result = await s.synthesise(st);
            expect(result.finalResponse).toBe("synthesised response");
            expect(chatModel.invoke).toHaveBeenCalled();
            expect(result.activeAgents).toEqual([]);
            expect(result.pendingAgents).toEqual([]);
        });

        it("includes supervisor messages in llm call", async () => {
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: false },
                chatModel,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[Supervisor] Parallel dispatch: menu, orders" },
                    { type: "ai", content: "[menu Agent]\nMenu data" },
                    { type: "ai", content: "[orders Agent]\nOrder data" },
                ],
            });
            await s.synthesise(st);
            const callArgs = chatModel.invoke.mock.calls[0][0] as Array<Record<string, unknown>>;
            const systemMsg = callArgs.find((m) => m.role === "system");
            expect(systemMsg).toBeDefined();
        });

        it("handles LLM API errors gracefully with fallback", async () => {
            chatModel.invoke.mockRejectedValue(new Error("API rate limit exceeded"));
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: false },
                chatModel,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nMenu data" },
                    { type: "ai", content: "[orders Agent]\nOrder data" },
                ],
            });
            const result = await s.synthesise(st);
            expect(result.finalResponse).toBeDefined();
            expect(result.finalResponse).toContain("rate limit");
        });

        it("handles 503/high demand errors with specific message", async () => {
            chatModel.invoke.mockRejectedValue(new Error("503 Service Unavailable — high demand"));
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: false },
                chatModel,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nMenu data" },
                ],
            });
            const result = await s.synthesise(st);
            expect(result.finalResponse).toContain("high demand");
        });

        it("propagates mcpContext into llm messages", async () => {
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: { ...supConfig, skipSynthesisWhenSingleAgent: false },
                chatModel,
            });
            const st = state({
                messages: [
                    { type: "human", content: "query" },
                    { type: "ai", content: "[menu Agent]\nData" },
                ],
                mcpContext: { menu: { items: ["a", "b"] } },
            });
            await s.synthesise(st);
            const callArgs = chatModel.invoke.mock.calls[0][0] as Array<Record<string, unknown>>;
            const jsonMsg = callArgs.find(
                (m) =>
                    m.role === "user" &&
                    typeof m.content === "string" &&
                    (m.content as string).includes("Sub-agent data"),
            );
            expect(jsonMsg).toBeDefined();
        });
    });

    describe("storeTurnIfRag", () => {
        it("does nothing when memory is not rag_augmented", async () => {
            const mem = mockMemory() as unknown as OrchidConversationMemory;
            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: {
                    ...supConfig,
                    memory: { strategy: "none", storeTurns: true, structuredOutput: false },
                },
                chatModel: null,
                memory: mem,
            });
            const st = state({ chatId: "c1" });
            await (s as any).storeTurnIfRag(
                st,
                "final",
                new OrchidAuthContext({ accessToken: "" }),
            );
            expect((mem as any).storeConversationTurn).not.toHaveBeenCalled();
        });

        it("stores both user and assistant turns when rag_augmented", async () => {
            const mem = {
                getRunningSummary: vi.fn().mockResolvedValue(null),
                updateRunningSummary: vi.fn().mockResolvedValue(undefined),
                storeConversationTurn: vi.fn().mockResolvedValue(undefined),
                strategy: "rag_augmented",
                storeTurns: true,
            } as unknown as OrchidConversationMemory & {
                storeConversationTurn: ReturnType<typeof vi.fn>;
                strategy: string;
                storeTurns: boolean;
            };

            const s = new ResponseSynthesizer({
                model: "test",
                supervisorConfig: {
                    ...supConfig,
                    memory: {
                        strategy: "rag_augmented",
                        storeTurns: true,
                        structuredOutput: false,
                    },
                },
                chatModel: null,
                memory: mem,
            });
            const st = state({
                chatId: "c1",
                messages: [{ type: "human", content: "test query" }],
            });
            await (s as any).storeTurnIfRag(
                st,
                "final response",
                new OrchidAuthContext({ accessToken: "" }),
            );
            expect(mem.storeConversationTurn).toHaveBeenCalledTimes(2);
        });
    });
});

describe("SYNTHESIS_SYSTEM_PROMPT", () => {
    it("contains {assistant_name} placeholder", () => {
        expect(SYNTHESIS_SYSTEM_PROMPT).toContain("{assistant_name}");
    });

    it("contains guidance about not re-answering previous questions", () => {
        expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).toContain("do not");
    });
});
