import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    filterInternalMessages,
    extractSingleAgentResponse,
    toLlmMessages,
    llmComplete,
} from "../../src/graph/supervisorHelpers.js";
import type { GraphState } from "../../src/graph/state.js";

function state(messages?: unknown[]): GraphState {
    return { messages: messages ?? [] } as GraphState;
}

describe("filterInternalMessages", () => {
    it("passes through human messages unchanged", () => {
        const msgs = [
            { type: "human", content: "hello" },
            { type: "human", content: "how are you" },
        ];
        expect(filterInternalMessages(msgs)).toEqual(msgs);
    });

    it("filters supervisor messages with default prefix", () => {
        const msgs = [
            { type: "human", content: "query" },
            { type: "ai", content: "[Supervisor] Parallel dispatch: menu, orders" },
            { type: "ai", content: "[Supervisor → menu] Do this" },
            { type: "ai", content: "[menu Agent]\nFound 3 items" },
        ];
        const result = filterInternalMessages(msgs);
        // All 3 ai messages start with '[Supervisor' so 2 supervisor + 1 human remain
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(msgs[0]);
        // The agent output '[menu Agent]' is NOT filtered — it does not start with '[Supervisor'
        expect(result[1]).toEqual(msgs[3]);
        expect(result[2]).toBeUndefined();
    });

    it("filters supervisor messages with custom prefixes", () => {
        const msgs = [
            { type: "ai", content: "[Orchestrator] Doing work" },
            { type: "ai", content: "Normal response" },
        ];
        const result = filterInternalMessages(msgs, ["[Orchestrator"]);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(msgs[1]);
    });

    it("handles messages without content gracefully", () => {
        const msgs = [{ type: "ai" }, { type: "human" }];
        const result = filterInternalMessages(msgs);
        expect(result).toHaveLength(2);
    });

    it("returns empty array for empty input", () => {
        expect(filterInternalMessages([])).toEqual([]);
    });

    it("keeps non-ai messages even if they match prefix", () => {
        const msgs = [{ type: "tool", content: "[Supervisor] tool output" }];
        expect(filterInternalMessages(msgs)).toEqual(msgs);
    });
});

describe("extractSingleAgentResponse", () => {
    it("returns null for empty messages", () => {
        expect(extractSingleAgentResponse(state([]))).toBeNull();
    });

    it("returns null when no human message found", () => {
        const st = state([{ type: "ai", content: "[menu Agent]\nSome response" }]);
        expect(extractSingleAgentResponse(st)).toBeNull();
    });

    it("extracts single agent response after human message", () => {
        const st = state([
            { type: "human", content: "show menu" },
            { type: "ai", content: "[menu Agent]\nHere is the menu: pizza, pasta, salad" },
        ]);
        expect(extractSingleAgentResponse(st)).toBe("Here is the menu: pizza, pasta, salad");
    });

    it("returns null when multiple agents responded", () => {
        const st = state([
            { type: "human", content: "query" },
            { type: "ai", content: "[menu Agent]\nMenu data" },
            { type: "ai", content: "[orders Agent]\nOrder data" },
        ]);
        expect(extractSingleAgentResponse(st)).toBeNull();
    });

    it("skips supervisor and tool-call messages", () => {
        const st = state([
            { type: "human", content: "query" },
            { type: "ai", content: "[Supervisor] Parallel dispatch: menu" },
            { type: "ai", content: "[menu Agent]\nFinal result" },
        ]);
        expect(extractSingleAgentResponse(st)).toBe("Final result");
    });

    it("ignores ai messages with tool_calls", () => {
        const st = state([
            { type: "human", content: "query" },
            { type: "ai", content: "[menu Agent]\nResult", tool_calls: [{}] },
        ]);
        expect(extractSingleAgentResponse(st)).toBeNull();
    });

    it("only considers messages after last human", () => {
        const st = state([
            { type: "human", content: "first query" },
            { type: "ai", content: "[menu Agent]\nFirst answer" },
            { type: "human", content: "second query" },
            { type: "ai", content: "[menu Agent]\nSecond answer" },
        ]);
        expect(extractSingleAgentResponse(st)).toBe("Second answer");
    });
});

describe("toLlmMessages", () => {
    it("inserts system message at the start", () => {
        const result = toLlmMessages("You are helpful.", [{ type: "human", content: "hello" }]);
        expect(result).toEqual([
            { role: "system", content: "You are helpful." },
            { role: "user", content: "hello" },
        ]);
    });

    it("maps human → user, ai → assistant", () => {
        const result = toLlmMessages("system", [
            { type: "human", content: "Q1" },
            { type: "ai", content: "A1" },
            { type: "human", content: "Q2" },
        ]);
        expect(result).toEqual([
            { role: "system", content: "system" },
            { role: "user", content: "Q1" },
            { role: "assistant", content: "A1" },
            { role: "user", content: "Q2" },
        ]);
    });

    it("skips non-human/non-ai messages", () => {
        const result = toLlmMessages("sys", [
            { type: "tool", content: "tool output" },
            { type: "human", content: "hello" },
        ]);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ role: "system", content: "sys" });
        expect(result[1]).toEqual({ role: "user", content: "hello" });
    });

    it("handles empty array", () => {
        expect(toLlmMessages("sys", [])).toEqual([{ role: "system", content: "sys" }]);
    });
});

describe("llmComplete", () => {
    it("calls chatModel.invoke and returns content", async () => {
        const chatModel = {
            invoke: vi.fn().mockResolvedValue({ content: "generated text" }),
        };

        const result = await llmComplete(chatModel, "gemini/flash", [
            { role: "system", content: "system prompt" },
            { role: "user", content: "user message" },
        ]);
        expect(result).toBe("generated text");
        expect(chatModel.invoke).toHaveBeenCalledWith(
            [
                { role: "system", content: "system prompt" },
                { role: "user", content: "user message" },
            ],
            { temperature: 0.0 },
        );
    });

    it("passes temperature and responseFormat opts", async () => {
        const chatModel = {
            invoke: vi.fn().mockResolvedValue({ content: "json" }),
        };
        await llmComplete(chatModel, "openai/gpt-4", [{ role: "user", content: "q" }], {
            temperature: 0.7,
            responseFormat: { type: "json_object" },
        });
        expect(chatModel.invoke).toHaveBeenCalledWith([{ role: "user", content: "q" }], {
            temperature: 0.7,
            response_format: { type: "json_object" },
        });
    });

    it("throws when chatModel is null", async () => {
        await expect(llmComplete(null, "any", [{ role: "user", content: "q" }])).rejects.toThrow(
            "Supervisor requires a chat model",
        );
    });

    it("uses default temperature of 0.0", async () => {
        const chatModel = { invoke: vi.fn().mockResolvedValue({ content: "ok" }) };
        await llmComplete(chatModel, "m", [{ role: "user", content: "q" }]);
        expect(chatModel.invoke).toHaveBeenCalledWith([{ role: "user", content: "q" }], {
            temperature: 0.0,
        });
    });

    it("handles null content gracefully", async () => {
        const chatModel = { invoke: vi.fn().mockResolvedValue({}) };
        const result = await llmComplete(chatModel, "m", [{ role: "user", content: "q" }]);
        expect(result).toBe("");
    });
});
