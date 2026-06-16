import { describe, it, expect } from "vitest";
import {
    ToolRegistry,
    buildToolInput,
    filterToSchema,
    getToolSchema,
} from "../../src/tools/registry.js";
import { OrchidTool, OrchidToolOutput } from "../../src/core/tool.js";
import type { OrchidToolInput } from "../../src/core/tool.js";

class TestTool extends OrchidTool {
    name = "test_tool";
    description = "A test tool";

    constructor(opts?: { name?: string; paramsSchema?: Record<string, unknown> }) {
        super();
        this.name = opts?.name ?? "test_tool";
        this.parametersSchema = opts?.paramsSchema ?? {
            type: "object",
            properties: { arg1: { type: "string" } },
        };
    }

    async invoke(input: OrchidToolInput): Promise<OrchidToolOutput> {
        return new OrchidToolOutput({ input: input.parameters });
    }
}

describe("ToolRegistry", () => {
    it("register adds a tool", () => {
        const registry = new ToolRegistry();
        const tool = new TestTool();
        registry.register(tool);
        expect(registry.get("test_tool")).toBe(tool);
    });

    it("register throws on duplicate name", () => {
        const registry = new ToolRegistry();
        registry.register(new TestTool());
        expect(() => registry.register(new TestTool())).toThrow("already registered");
    });

    it("get returns tool by name", () => {
        const registry = new ToolRegistry();
        registry.register(new TestTool({ name: "my_tool" }));
        const tool = registry.get("my_tool");
        expect(tool.name).toBe("my_tool");
    });

    it("get throws for unknown tool", () => {
        const registry = new ToolRegistry();
        expect(() => registry.get("unknown")).toThrow("not found");
    });

    it("getAll returns readonly map", () => {
        const registry = new ToolRegistry();
        registry.register(new TestTool({ name: "a" }));
        registry.register(new TestTool({ name: "b" }));
        const all = registry.getAll();
        expect(all.size).toBe(2);
        expect(all.has("a")).toBe(true);
        expect(all.has("b")).toBe(true);
    });

    it("unregister removes a tool", () => {
        const registry = new ToolRegistry();
        registry.register(new TestTool({ name: "temp" }));
        registry.unregister("temp");
        expect(() => registry.get("temp")).toThrow("not found");
    });

    it("clear removes all tools", () => {
        const registry = new ToolRegistry();
        registry.register(new TestTool({ name: "a" }));
        registry.register(new TestTool({ name: "b" }));
        registry.clear();
        expect(registry.getAll().size).toBe(0);
    });
});

describe("buildToolInput", () => {
    it("builds with default values", () => {
        const input = buildToolInput();
        expect(input.parameters).toEqual({});
        expect(input.query).toBeNull();
        expect(input.context).toBeNull();
        expect(input.authContext).toBeUndefined();
        expect(input.contentSources).toBeUndefined();
    });

    it("builds with provided parameters", () => {
        const input = buildToolInput({
            parameters: { key: "val" },
            query: "test query",
            context: { ctx: "data" },
        });
        expect(input.parameters).toEqual({ key: "val" });
        expect(input.query).toBe("test query");
        expect(input.context).toEqual({ ctx: "data" });
    });

    it("builds with authContext", () => {
        const auth = { token: "xyz" };
        const input = buildToolInput({ authContext: auth });
        expect(input.authContext).toBe(auth);
    });

    it("builds with contentSources", () => {
        const sources = [{ type: "file", id: "f1" }];
        const input = buildToolInput({ contentSources: sources });
        expect(input.contentSources).toBe(sources);
    });
});

describe("filterToSchema", () => {
    it("returns safe default for null input", () => {
        expect(filterToSchema(null)).toEqual({ type: "object", properties: {} });
    });

    it("returns safe default for undefined input", () => {
        expect(filterToSchema(undefined)).toEqual({ type: "object", properties: {} });
    });

    it("adds type: object if missing", () => {
        const result = filterToSchema({ properties: { a: { type: "string" } } });
        expect(result.type).toBe("object");
    });

    it("strips framework-reserved keys", () => {
        const schema = {
            type: "object",
            properties: {
                query: { type: "string" },
                context: { type: "object" },
                auth_context: { type: "string" },
                content_sources: { type: "array" },
                user_param: { type: "string" },
            },
        };
        const result = filterToSchema(schema);
        const props = result.properties as Record<string, unknown>;
        expect(props.query).toBeUndefined();
        expect(props.context).toBeUndefined();
        expect(props.auth_context).toBeUndefined();
        expect(props.content_sources).toBeUndefined();
        expect(props.user_param).toBeDefined();
    });

    it("adds empty properties if missing", () => {
        const result = filterToSchema({ type: "object" });
        expect(result.properties).toEqual({});
    });
});

describe("getToolSchema", () => {
    it("returns filtered schema for registered tool", () => {
        const registry = new ToolRegistry();
        registry.register(
            new TestTool({
                name: "schema_tool",
                paramsSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string" },
                        my_arg: { type: "number" },
                    },
                },
            }),
        );

        const schema = getToolSchema(registry, "schema_tool");
        const props = schema.properties as Record<string, unknown>;
        expect(props.query).toBeUndefined();
        expect(props.my_arg).toBeDefined();
    });

    it("throws for unregistered tool", () => {
        const registry = new ToolRegistry();
        expect(() => getToolSchema(registry, "missing")).toThrow();
    });
});
