import { describe, it, expect } from "vitest";
import {
    OrchidAgentConfigSchema,
    OrchidAgentsConfigSchema,
    OrchidDefaultsConfigSchema,
    buildAgentsConfig,
} from "../../src/config/schema/index.js";

describe("Config Schema - Agent & AgentsConfig", () => {
    it("parses minimal agent config", () => {
        const result = OrchidAgentConfigSchema.parse({
            description: "Test agent",
            prompt: "You are a helpful assistant",
        });
        expect(result.name).toBe("");
        expect(result.description).toBe("Test agent");
        expect(result.prompt).toBe("You are a helpful assistant");
        expect(result.maxToolRounds).toBe(15);
        expect(result.maxConsecutiveDupes).toBe(2);
        expect(result.parallelTools).toBe(false);
    });

    it("parses agent config with tools", () => {
        const result = OrchidAgentConfigSchema.parse({
            description: "Tool user",
            prompt: "Use tools",
            tools: ["search", "files"],
            mcpServers: [
                {
                    name: "api-server",
                    url: "http://localhost:8080/mcp",
                    tools: [{ name: "search" }],
                },
            ],
        });
        expect(result.tools).toEqual(["search", "files"]);
        expect(result.mcpServers).toHaveLength(1);
        expect(result.mcpServers[0].name).toBe("api-server");
    });

    it("parses agent config with LLM override", () => {
        const result = OrchidAgentConfigSchema.parse({
            description: "Custom LLM",
            prompt: "You are an expert",
            llm: {
                model: "openai/gpt-4o",
                temperature: 0.5,
            },
        });
        expect(result.llm).not.toBeNull();
        expect(result.llm!.model).toBe("openai/gpt-4o");
    });

    it("parses agent config with mini-agent enabled", () => {
        const result = OrchidAgentConfigSchema.parse({
            description: "Parallel thinker",
            prompt: "Think in parallel",
            miniAgent: {
                enabled: true,
                maxCount: 5,
            },
        });
        expect(result.miniAgent.enabled).toBe(true);
        expect(result.miniAgent.maxCount).toBe(5);
    });

    it("parses agents config with multiple agents", () => {
        const result = OrchidAgentsConfigSchema.parse({
            agents: {
                helper: {
                    description: "Helpful agent",
                    prompt: "I help",
                },
                expert: {
                    description: "Expert agent",
                    prompt: "I am expert",
                },
            },
        });
        expect(Object.keys(result.agents)).toHaveLength(2);
        expect(result.version).toBe("1");
    });

    it("parses agents config with defaults", () => {
        const result = OrchidAgentsConfigSchema.parse({
            defaults: {
                llm: { model: "gemini/gemini-flash" },
                rag: { k: 10, enabled: false },
                cacheEnabled: true,
            },
            agents: {
                router: {
                    description: "Routing agent",
                    prompt: "Route requests",
                },
            },
        });
        expect(result.defaults.llm.model).toBe("gemini/gemini-flash");
        expect(result.defaults.rag.k).toBe(10);
        expect(result.defaults.cacheEnabled).toBe(true);
    });

    it("parses agents config with events", () => {
        const result = OrchidAgentsConfigSchema.parse({
            agents: {
                worker: {
                    description: "Worker",
                    prompt: "Do work",
                },
            },
            events: {
                enabled: true,
                processors: [{ type: "logger", config: {} }],
            },
        });
        expect(result.events).not.toBeNull();
        expect(result.events!.enabled).toBe(true);
        expect(result.events!.processors).toHaveLength(1);
    });

    it("parses agents config with mcp gateway", () => {
        const result = OrchidAgentsConfigSchema.parse({
            agents: {
                kb: {
                    description: "Knowledge base",
                    prompt: "Answer from KB",
                },
            },
            mcpGateway: {
                tools: {
                    orchid_ask: { title: "Ask KB" },
                },
            },
        });
        expect(Object.keys(result.mcpGateway.tools)).toHaveLength(1);
    });

    it("buildAgentsConfig applies defaults", () => {
        const config = buildAgentsConfig({
            agents: {
                testAgent: {
                    description: "Test agent",
                    prompt: "Hello",
                },
            },
        });

        expect(config.agents.testAgent.name).toBe("testAgent");
        expect(config.agents.testAgent.maxToolRounds).toBe(15);
        expect(config.agents.testAgent.rag.enabled).toBe(true);
        expect(config.agents.testAgent.rag.k).toBe(5);
    });

    it("propagates defaults.rag.enabled: false to agents", () => {
        const config = buildAgentsConfig({
            defaults: {
                rag: { enabled: false },
            },
            agents: {
                foo: {
                    description: "Foo agent",
                    prompt: "Foo",
                },
                bar: {
                    description: "Bar agent",
                    prompt: "Bar",
                    rag: { enabled: true },
                },
            },
        });

        // foo didn't explicitly set rag — should inherit false from defaults
        expect(config.agents.foo.rag.enabled).toBe(false);

        // bar explicitly set rag.enabled: true — should keep its value
        expect(config.agents.bar.rag.enabled).toBe(true);
    });

    it("propagates defaults.rag.enabled: false to nested children", () => {
        const config = buildAgentsConfig({
            defaults: {
                rag: { enabled: false },
            },
            agents: {
                parent: {
                    description: "Parent",
                    prompt: "Parent prompt",
                    children: {
                        child1: {
                            description: "Child 1",
                            prompt: "Child 1 prompt",
                        },
                        child2: {
                            description: "Child 2",
                            prompt: "Child 2 prompt",
                            rag: { enabled: true },
                        },
                    },
                },
            },
        });

        const children = config.agents.parent.children!;
        // child1 didn't set rag — inherits false from defaults
        expect(children.child1.rag.enabled).toBe(false);
        // child2 explicitly set rag.enabled: true — keeps its value
        expect(children.child2.rag.enabled).toBe(true);
    });

    it("parses defaults config", () => {
        const result = OrchidDefaultsConfigSchema.parse({});
        expect(result.llm.model).toBe("gemini/gemini-2.5-flash");
        expect(result.cacheEnabled).toBe(false);
    });
});
