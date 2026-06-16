import { describe, it, expect, beforeEach } from "vitest";
import { registerAgentClass, clearRegistry, getAgentClass } from "../../src/config/registry.js";
import type { OrchidAgent } from "../../src/core/agent.js";

// Minimal mock agent class
class MockAgent {
    name = "mock";
    async run(): Promise<unknown> {
        return null;
    }
    async summarise(): Promise<string> {
        return "";
    }
}

describe("Agent Class Registry", () => {
    beforeEach(() => {
        clearRegistry();
    });

    it("registers and retrieves an agent class", async () => {
        registerAgentClass("mock", MockAgent as unknown as new (...args: unknown[]) => OrchidAgent);
        const cls = await getAgentClass("mock");
        expect(cls).toBe(MockAgent);
    });

    it("throws for unregistered short name", async () => {
        await expect(getAgentClass("nonexistent")).rejects.toThrow("Cannot resolve agent class");
    });

    it("throws for null classPath (GenericAgent not yet available)", async () => {
        await expect(getAgentClass(null)).rejects.toThrow("GenericAgent not yet available");
    });

    it("clearRegistry removes all classes", async () => {
        registerAgentClass("test", MockAgent as unknown as new (...args: unknown[]) => OrchidAgent);
        clearRegistry();
        await expect(getAgentClass("test")).rejects.toThrow("Cannot resolve agent class");
    });
});
