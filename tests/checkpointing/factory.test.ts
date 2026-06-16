import { describe, it, expect } from "vitest";
import {
    buildCheckpointer,
    shutdownCheckpointer,
    registerCheckpointer,
} from "../../src/checkpointing/factory.js";

describe("buildCheckpointer", () => {
    it('returns MemorySaver for "memory" type', async () => {
        const saver = await buildCheckpointer("memory");
        expect(saver).toBeDefined();
        expect(typeof (saver as any).get).toBe("function");
        expect(typeof (saver as any).put).toBe("function");
    });

    it("returns MemorySaver for empty string", async () => {
        const saver = await buildCheckpointer("");
        expect(saver).toBeDefined();
    });

    it("returns MemorySaver for undefined", async () => {
        const saver = await buildCheckpointer(undefined);
        expect(saver).toBeDefined();
    });

    it("memory saver stores and retrieves checkpoints", async () => {
        const saver = (await buildCheckpointer("memory")) as any;
        const config = { configurable: { thread_id: "t1" } };
        const checkpoint = { state: { messages: [] } };

        await saver.put(config, checkpoint);
        const result = await saver.get(config);
        expect(result).toEqual(checkpoint);
    });

    it("memory saver returns undefined for unknown thread", async () => {
        const saver = (await buildCheckpointer("memory")) as any;
        const result = await saver.get({ configurable: { thread_id: "nonexistent" } });
        expect(result).toBeUndefined();
    });

    it("returns registered custom checkpointer", async () => {
        const fakeSaver = { type: "custom", get: () => null, put: () => {} };
        registerCheckpointer("custom_type", async () => fakeSaver);

        const result = await buildCheckpointer("custom_type");
        expect(result).toBe(fakeSaver);
    });
});

describe("shutdownCheckpointer", () => {
    it("does not throw for non-object/null", async () => {
        await expect(shutdownCheckpointer(null)).resolves.toBeUndefined();
        await expect(shutdownCheckpointer(undefined)).resolves.toBeUndefined();
        await expect(shutdownCheckpointer("string")).resolves.toBeUndefined();
    });

    it("calls close() if available", async () => {
        let closed = false;
        const saver = {
            close: async () => {
                closed = true;
            },
        };

        await shutdownCheckpointer(saver);
        expect(closed).toBe(true);
    });

    it("calls destroy() if close not available", async () => {
        let destroyed = false;
        const saver = {
            destroy: async () => {
                destroyed = true;
            },
        };

        await shutdownCheckpointer(saver);
        expect(destroyed).toBe(true);
    });

    it("prefers close over destroy", async () => {
        const calls: string[] = [];
        const saver = {
            close: async () => {
                calls.push("close");
            },
            destroy: async () => {
                calls.push("destroy");
            },
        };

        await shutdownCheckpointer(saver);
        expect(calls).toEqual(["close"]);
    });

    it("does not throw on close/destroy errors", async () => {
        const saver = {
            close: async () => {
                throw new Error("cannot close");
            },
        };
        await expect(shutdownCheckpointer(saver)).resolves.toBeUndefined();
    });
});
