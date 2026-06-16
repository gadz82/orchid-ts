import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    createSupervisorNode,
    routeToAgents,
    ROUTING_SYSTEM_PROMPT,
} from "../../src/graph/supervisor.js";
import type { GraphState } from "../../src/graph/state.js";
import { OrchidAuthContext } from "../../src/core/state.js";

function state(overrides?: Partial<GraphState>): GraphState {
    return {
        messages: [],
        activeAgents: [],
        pendingAgents: [],
        mcpContext: {},
        ...overrides,
    };
}

function makeChatModel(content = "{}") {
    return {
        ainvoke: vi.fn().mockResolvedValue({ content }),
        withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ content }),
            ainvoke: vi.fn().mockResolvedValue({ content }),
        }),
    };
}

const agentDescriptions = {
    menu: "Retrieves menu information",
    orders: "Manages orders",
    search: "Searches knowledge base",
};

describe("createSupervisorNode", () => {
    let chatModel: ReturnType<typeof makeChatModel>;

    beforeEach(() => {
        chatModel = makeChatModel();
    });

    it("routes to single agent with parallel dispatch", async () => {
        const chatModelWithOutput = {
            ainvoke: vi.fn().mockResolvedValue({
                content:
                    '{"reasoning": "menu lookup", "execution": "parallel", "agents": ["menu"], "skill": null, "directResponse": null}',
            }),
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    reasoning: "menu lookup",
                    execution: "parallel",
                    agents: ["menu"],
                    skill: null,
                    directResponse: null,
                }),
            }),
        };

        const node = createSupervisorNode({
            model: "test",
            agentDescriptions,
            chatModel: chatModelWithOutput as any,
        });

        const st = state({
            messages: [{ type: "human", content: "Show me the menu" }],
        });

        const result = await node(st, {
            configurable: { auth_context: new OrchidAuthContext({ accessToken: "" }) },
        });

        expect(result.activeAgents).toEqual(["menu"]);
        expect(result.executionMode).toBe("parallel");
        expect(result.pendingAgents).toEqual([]);
    });

    it("handles direct response from LLM", async () => {
        const chatModelWithOutput = {
            ainvoke: vi.fn().mockResolvedValue({ content: "{}" }),
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    reasoning: "greeting",
                    execution: "parallel",
                    agents: [],
                    skill: null,
                    directResponse: "Hello! How can I help you today?",
                }),
            }),
        };

        const node = createSupervisorNode({
            model: "test",
            agentDescriptions,
            chatModel: chatModelWithOutput as any,
        });

        const st = state({
            messages: [{ type: "human", content: "Hello" }],
        });

        const result = await node(st, {
            configurable: { auth_context: new OrchidAuthContext({ accessToken: "" }) },
        });

        expect(result.finalResponse).toBe("Hello! How can I help you today?");
    });

    it("routes sequential when multiple dependent agents", async () => {
        const chatModelWithOutput = {
            ainvoke: vi.fn().mockResolvedValue({ content: "{}" }),
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    reasoning: "search then format",
                    execution: "sequential",
                    agents: ["search", "menu"],
                    skill: null,
                    directResponse: null,
                }),
            }),
        };

        const node = createSupervisorNode({
            model: "test",
            agentDescriptions,
            chatModel: chatModelWithOutput as any,
        });

        const st = state({
            messages: [{ type: "human", content: "Find and present results" }],
        });

        const result = await node(st, {
            configurable: { auth_context: new OrchidAuthContext({ accessToken: "" }) },
        });

        expect(result.activeAgents).toEqual(["search"]);
        expect(result.pendingAgents).toEqual(["menu"]);
        expect(result.executionMode).toBe("sequential");
    });

    it("handles LLM API error with graceful fallback", async () => {
        const failingModel = {
            ainvoke: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
            }),
        };

        const node = createSupervisorNode({
            model: "test",
            agentDescriptions,
            chatModel: failingModel as any,
        });

        const st = state({
            messages: [{ type: "human", content: "query" }],
        });

        const result = await node(st, {
            configurable: { auth_context: new OrchidAuthContext({ accessToken: "" }) },
        });

        expect(result.finalResponse).toBeDefined();
        expect(result.finalResponse).toContain("high demand");
        expect(result.activeAgents).toEqual([]);
    });

    it("handles unrecognized agent names with fallback", async () => {
        const chatModelWithOutput = {
            ainvoke: vi.fn().mockResolvedValue({ content: "{}" }),
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    reasoning: "using nonexistent agent",
                    execution: "parallel",
                    agents: ["nonexistent"],
                    skill: null,
                    directResponse: null,
                }),
            }),
        };

        const node = createSupervisorNode({
            model: "test",
            agentDescriptions,
            chatModel: chatModelWithOutput as any,
        });

        const st = state({
            messages: [{ type: "human", content: "Do something" }],
        });

        const result = await node(st, {
            configurable: { auth_context: new OrchidAuthContext({ accessToken: "" }) },
        });

        expect(result.finalResponse).toBeDefined();
    });

    it("triggers synthesis when agents have produced output and none pending", async () => {
        const chatModelWithOutput = {
            ainvoke: vi.fn().mockResolvedValue({ content: "synthesis" }),
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({}),
            }),
        };

        const node = createSupervisorNode({
            model: "test",
            agentDescriptions,
            chatModel: chatModelWithOutput as any,
        });

        const st = state({
            messages: [
                { type: "human", content: "query" },
                { type: "ai", content: "[menu Agent]\nResult" },
            ],
            activeAgents: [],
            pendingAgents: [],
        });

        const result = await node(st, {
            configurable: { auth_context: new OrchidAuthContext({ accessToken: "" }) },
        });

        expect(result.finalResponse).toBeDefined();
    });

    it("re-routes to supervisor when pending agents remain", async () => {
        const chatModelWithOutput = {
            ainvoke: vi.fn().mockResolvedValue({ content: "handoff" }),
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({}),
            }),
        };

        const node = createSupervisorNode({
            model: "test",
            agentDescriptions,
            chatModel: chatModelWithOutput as any,
        });

        const st = state({
            messages: [
                { type: "human", content: "query" },
                { type: "ai", content: "[search Agent]\nData" },
            ],
            pendingAgents: ["menu"],
            activeAgents: [],
        });

        const result = await node(st, {
            configurable: { auth_context: new OrchidAuthContext({ accessToken: "" }) },
        });

        expect(result.activeAgents).toBeDefined();
        expect(result.activeAgents![0]).toBe("menu");
    });
});

describe("routeToAgents", () => {
    it("returns parallel Send-like objects for parallel mode", () => {
        const st = state({
            activeAgents: ["menu", "orders"],
            executionMode: "parallel",
        });
        const result = routeToAgents(st);
        expect(Array.isArray(result)).toBe(true);
        expect((result as Array<unknown>).length).toBe(2);
        expect((result as Array<{ node: string }>)[0].node).toBe("menu_agent");
        expect((result as Array<{ node: string }>)[1].node).toBe("orders_agent");
    });

    it("returns single agent node name for sequential mode", () => {
        const st = state({
            activeAgents: ["search"],
            executionMode: "sequential",
        });
        expect(routeToAgents(st)).toBe("search_agent");
    });

    it("returns __end__ when finalResponse is set", () => {
        const st = state({ finalResponse: "done" });
        expect(routeToAgents(st)).toBe("__end__");
    });

    it("returns __end__ when no active agents or final response", () => {
        expect(routeToAgents(state({}))).toBe("__end__");
    });

    it("returns supervisor when pending agents remain", () => {
        const st = state({ pendingAgents: ["menu"] });
        expect(routeToAgents(st)).toBe("supervisor");
    });

    it("returns output_guardrails when hasOutputGuardrails is set", () => {
        const st = state({ finalResponse: "done", hasOutputGuardrails: true });
        expect(routeToAgents(st)).toBe("output_guardrails");
    });
});

describe("ROUTING_SYSTEM_PROMPT", () => {
    it("contains agent_descriptions placeholder", () => {
        expect(ROUTING_SYSTEM_PROMPT).toContain("{agent_descriptions}");
    });

    it("contains skill_descriptions placeholder", () => {
        expect(ROUTING_SYSTEM_PROMPT).toContain("{skill_descriptions}");
    });

    it("contains execution mode instructions", () => {
        expect(ROUTING_SYSTEM_PROMPT).toContain("parallel");
        expect(ROUTING_SYSTEM_PROMPT).toContain("sequential");
    });
});
