import { describe, it, expect } from "vitest";
import { JobStatus, RetryPolicy } from "../../src/core/events/job.js";
import { OrchidTruncationStrategy } from "../../src/core/truncation.js";
import { OrchidRAGLevel } from "../../src/core/scopes.js";
import { NullConversationMemory } from "../../src/core/memory.js";
import { globalPendingInterrupts } from "../../src/core/pendingInterrupts.js";

describe("JobStatus", () => {
    it("has expected values", () => {
        expect(JobStatus.PENDING).toBe("pending");
        expect(JobStatus.RUNNING).toBe("running");
        expect(JobStatus.SUCCEEDED).toBe("succeeded");
        expect(JobStatus.FAILED).toBe("failed");
        expect(JobStatus.CANCELLED).toBe("cancelled");
    });
});

describe("RetryPolicy", () => {
    it("computes exponential backoff", () => {
        const policy = new RetryPolicy({ maxAttempts: 3, backoff: "exponential", jitter: false });
        expect(policy.delayFor(1)).toBe(1);
        expect(policy.delayFor(2)).toBe(2);
        expect(policy.delayFor(3)).toBe(4);
    });

    it("caps at max delay", () => {
        const policy = new RetryPolicy({
            maxAttempts: 3,
            initialDelaySeconds: 1000,
            maxDelaySeconds: 10,
            jitter: false,
        });
        expect(policy.delayFor(1)).toBe(10);
    });

    it("fixed backoff returns constant", () => {
        const policy = new RetryPolicy({ backoff: "fixed", initialDelaySeconds: 5, jitter: false });
        expect(policy.delayFor(1)).toBe(5);
        expect(policy.delayFor(10)).toBe(5);
    });
});

describe("OrchidTruncationStrategy", () => {
    it("has expected values", () => {
        expect(OrchidTruncationStrategy.HARD).toBe("hard");
        expect(OrchidTruncationStrategy.MIDDLE).toBe("middle");
        expect(OrchidTruncationStrategy.LLM).toBe("llm");
        expect(OrchidTruncationStrategy.SEMANTIC).toBe("semantic");
    });
});

describe("OrchidRAGLevel", () => {
    it("has five levels", () => {
        expect(OrchidRAGLevel.ROOT).toBe(0);
        expect(OrchidRAGLevel.AGENT).toBe(4);
    });
});

describe("NullConversationMemory", () => {
    it("returns null on load", async () => {
        const mem = new NullConversationMemory();
        expect(await mem.load("c1", "a1")).toBeNull();
    });

    it("save and clear are no-ops", async () => {
        const mem = new NullConversationMemory();
        await mem.clear("c1", "a1");
        // No error means success
    });
});

describe("PendingInterruptStore", () => {
    it("stores and retrieves", () => {
        globalPendingInterrupts.clear();
        globalPendingInterrupts.set("thread-1", {
            toolName: "delete",
            arguments: {},
            agentName: "a",
        });
        const payload = globalPendingInterrupts.get("thread-1");
        expect(payload?.toolName).toBe("delete");
        expect(globalPendingInterrupts.delete("thread-1")).toBe(true);
        expect(globalPendingInterrupts.get("thread-1")).toBeUndefined();
    });
});
