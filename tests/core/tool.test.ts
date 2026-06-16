import { describe, it, expect } from "vitest";
import { OrchidTool, OrchidToolOutput } from "../../src/core/tool.js";
import type { OrchidToolInput } from "../../src/core/tool.js";

class TestTool extends OrchidTool {
    name = "test_tool";
    description = "a test tool";
    parametersSchema = {
        type: "object",
        properties: { param1: { type: "string" } },
    };

    async invoke(input: OrchidToolInput) {
        return new OrchidToolOutput(input.parameters["param1"]);
    }
}

describe("OrchidTool", () => {
    it("has name, description, schema", () => {
        const tool = new TestTool();
        expect(tool.name).toBe("test_tool");
        expect(tool.description).toBe("a test tool");
    });

    it("copies parameters schema", () => {
        const tool = new TestTool();
        const schema = tool.getParametersSchema();
        expect(schema.type).toBe("object");
        expect(schema.properties["param1"]).toEqual({ type: "string" });
    });

    it("generates LLM function schema", () => {
        const tool = new TestTool();
        const schema = tool.getLLMFunctionSchema();
        expect(schema.type).toBe("function");
        expect(schema.function.name).toBe("test_tool");
    });

    it("invoke returns output", async () => {
        const tool = new TestTool();
        const output = await tool.invoke({ parameters: { param1: "hello" } });
        expect(output.result).toBe("hello");
    });
});
