import { describe, it, expect, vi } from "vitest";
import {
    SequentialAdvancer,
    SEQUENTIAL_ADVANCE_SYSTEM_PROMPT,
} from "../../src/graph/sequentialAdvancer.js";
import type { GraphState } from "../../src/graph/state.js";

function state(overrides?: Partial<GraphState>): GraphState {
    return {
        messages: [],
        activeAgents: [],
        pendingAgents: [],
        mcpContext: {},
        skillInstructions: {},
        ...overrides,
    };
}

function makeChatModel(content = "handoff message") {
    return { invoke: vi.fn().mockResolvedValue({ content }) };
}

describe("SequentialAdvancer", () => {
    const agentDescriptions = {
        search: "Searches the knowledge base",
        summarise: "Summarises results",
        format: "Formats the answer",
    };

    const supConfig = {
        assistantName: "Orchid",
        historyMaxTurns: 20,
        historyMaxChars: 1000,
        historySummaryEnabled: false,
        historySummaryRecentTurns: 10,
        memory: { strategy: "none", structuredOutput: false },
    };

    it("advances to next agent with handoff message", async () => {
        const chatModel = makeChatModel(
            "handoff message: please summarise the search results found above.",
        );
        const advancer = new SequentialAdvancer({
            model: "test",
            agentDescriptions,
            supervisorConfig: supConfig as any,
            chatModel,
        });

        const st = state({
            pendingAgents: ["summarise", "format"],
            messages: [
                { type: "human", content: "search query" },
                { type: "ai", content: "[search Agent]\nFound 10 documents" },
            ],
        });

        const result = await advancer.advance(st, ["summarise", "format"]);

        expect(result.activeAgents).toEqual(["summarise"]);
        expect(result.pendingAgents).toEqual(["format"]);
        expect(result.executionMode).toBe("sequential");
        expect(result.messages).toBeDefined();
        const msg = (result.messages as Array<Record<string, unknown>>)[0];
        expect(String(msg.content)).toContain("[Supervisor → summarise]");
        expect(String(msg.content)).toContain("handoff message");
    });

    it("handles last step in pipeline with (last step) marker", async () => {
        const chatModel = makeChatModel("Final step handoff.");
        const advancer = new SequentialAdvancer({
            model: "test",
            agentDescriptions,
            supervisorConfig: supConfig as any,
            chatModel,
        });

        const result = await advancer.advance(state(), ["format"]);

        expect(result.activeAgents).toEqual(["format"]);
        expect(result.pendingAgents).toEqual([]);
    });

    it("includes skill instructions when present in state", async () => {
        const chatModel = makeChatModel("Handoff with skill.");
        const advancer = new SequentialAdvancer({
            model: "test",
            agentDescriptions,
            supervisorConfig: supConfig as any,
            chatModel,
        });

        const st = state({
            pendingAgents: ["summarise"],
            skillInstructions: {
                summarise: "Summarise in 3 bullet points",
            },
        });

        const result = await advancer.advance(st, ["summarise"]);

        const llmCallArgs = chatModel.invoke.mock.calls[0][0] as Array<Record<string, unknown>>;
        const systemMsg = llmCallArgs.find((m) => m.role === "system");
        expect(String(systemMsg!.content)).toContain("Summarise in 3 bullet points");
    });

    it("falls back to handoff message on LLM error", async () => {
        const chatModel = makeChatModel("");
        chatModel.invoke.mockRejectedValue(new Error("timeout"));
        const advancer = new SequentialAdvancer({
            model: "test",
            agentDescriptions,
            supervisorConfig: supConfig as any,
            chatModel,
        });

        const result = await advancer.advance(state(), ["summarise"]);

        const msg = (result.messages as Array<Record<string, unknown>>)[0];
        expect(String(msg.content)).toContain("Continue with summarise");
    });

    it("includes mcpContext as JSON in llm messages", async () => {
        const chatModel = makeChatModel("ok");
        const advancer = new SequentialAdvancer({
            model: "test",
            agentDescriptions,
            supervisorConfig: supConfig as any,
            chatModel,
        });

        const st = state({
            pendingAgents: ["summarise"],
            mcpContext: { search: { results: 5 } },
        });

        await advancer.advance(st, ["summarise"]);

        const llmCallArgs = chatModel.invoke.mock.calls[0][0] as Array<Record<string, unknown>>;
        const dataMsg = llmCallArgs.find(
            (m) =>
                m.role === "user" &&
                typeof m.content === "string" &&
                (m.content as string).includes("Data collected so far"),
        );
        expect(dataMsg).toBeDefined();
        expect(String(dataMsg!.content)).toContain('"results": 5');
    });

    it("includes remaining pipeline in system prompt", async () => {
        const chatModel = makeChatModel("ok");
        const advancer = new SequentialAdvancer({
            model: "test",
            agentDescriptions,
            supervisorConfig: supConfig as any,
            chatModel,
        });

        await advancer.advance(state(), ["summarise", "format"]);

        const llmCallArgs = chatModel.invoke.mock.calls[0][0] as Array<Record<string, unknown>>;
        const systemMsg = llmCallArgs.find((m) => m.role === "system");
        expect(String(systemMsg!.content)).toContain("format");
    });
});

describe("SEQUENTIAL_ADVANCE_SYSTEM_PROMPT", () => {
    it("contains placeholder for assistant_name", () => {
        expect(SEQUENTIAL_ADVANCE_SYSTEM_PROMPT).toContain("{assistant_name}");
    });

    it("contains placeholder for next_agent", () => {
        expect(SEQUENTIAL_ADVANCE_SYSTEM_PROMPT).toContain("{next_agent}");
    });
});
