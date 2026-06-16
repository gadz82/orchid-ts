import { describe, it, expect } from "vitest";
import { OrchidMCPToolResult } from "../../src/core/mcpResult.js";
import { OrchidMCPAuthRequiredError, OrchidMCPDiscoveryError } from "../../src/core/mcpErrors.js";
import { GraphInterrupt, isGraphInterrupt } from "../../src/core/graphInterrupt.js";

describe("OrchidMCPToolResult", () => {
    it("empty result has empty text", () => {
        const r = new OrchidMCPToolResult();
        expect(r.text).toBe("");
        expect(r.isError).toBe(false);
    });

    it("concatenates text blocks", () => {
        const r = new OrchidMCPToolResult([
            { type: "text", text: "hello" },
            { type: "image" },
            { type: "text", text: "world" },
        ]);
        expect(r.text).toBe("hello\nworld");
    });

    it("marks error", () => {
        const r = new OrchidMCPToolResult([], true);
        expect(r.isError).toBe(true);
    });
});

describe("MCP Errors", () => {
    it("OrchidMCPAuthRequiredError", () => {
        const err = new OrchidMCPAuthRequiredError("myserver");
        expect(err.serverName).toBe("myserver");
        expect(err.name).toBe("OrchidMCPAuthRequiredError");
        expect(err.message).toContain("myserver");
    });

    it("OrchidMCPDiscoveryError", () => {
        const err = new OrchidMCPDiscoveryError("srv", "bad config");
        expect(err.serverName).toBe("srv");
        expect(err.reason).toBe("bad config");
    });
});

describe("GraphInterrupt", () => {
    it("creates interrupt with payload", () => {
        const err = new GraphInterrupt({
            toolName: "delete_file",
            arguments: { path: "/tmp/x" },
            agentName: "myagent",
        });
        expect(err.interruptValue.toolName).toBe("delete_file");
        expect(err.interruptValue.agentName).toBe("myagent");
        expect(err.name).toBe("GraphInterrupt");
    });

    it("isGraphInterrupt type guard", () => {
        const err = new GraphInterrupt({ toolName: "x", arguments: {}, agentName: "a" });
        expect(isGraphInterrupt(err)).toBe(true);
        expect(isGraphInterrupt(new Error("nope"))).toBe(false);
        expect(isGraphInterrupt({})).toBe(false);
    });
});
