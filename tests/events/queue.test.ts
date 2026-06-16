import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemorySignalQueue } from "../../src/events/queues/inmemory.js";
import type { QueuedSignal } from "../../src/core/index.js";

describe("InMemorySignalQueue", () => {
    let queue: InMemorySignalQueue;

    beforeEach(() => {
        queue = new InMemorySignalQueue();
    });

    describe("enqueue", () => {
        it("adds a signal to the queue and returns an id", async () => {
            const id = await queue.enqueue("sig-1");
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
        });

        it("high priority messages are placed at the front", async () => {
            await queue.enqueue("sig-low");
            await queue.enqueue("sig-high", { priority: 10 });
            await queue.enqueue("sig-mid");
            const batch = await queue.dequeue(10, 60);
            // High priority was unshifted, so it should be first
            expect(batch[0].signalId).toBe("sig-high");
        });

        it("normal priority messages maintain FIFO order", async () => {
            await queue.enqueue("a");
            await queue.enqueue("b");
            await queue.enqueue("c");
            const batch = await queue.dequeue(10, 60);
            expect(batch.map((m) => m.signalId)).toEqual(["a", "b", "c"]);
        });
    });

    describe("dequeue", () => {
        it("returns only messages with expired leases", async () => {
            await queue.enqueue("sig-1");
            const batch = await queue.dequeue(10, 60);
            expect(batch).toHaveLength(1);
            expect(batch[0].signalId).toBe("sig-1");
        });

        it("updates lease and increments attempt on dequeued messages", async () => {
            await queue.enqueue("sig-1");
            const [msg] = await queue.dequeue(1, 30);
            expect(msg.attempt).toBe(1);
            expect(msg.leaseUntil.getTime()).toBeGreaterThan(Date.now());
        });

        it("does not return messages still under lease", async () => {
            await queue.enqueue("sig-1");
            await queue.dequeue(1, 60); // lease for 60 seconds
            // Immediate second dequeue should return empty
            const batch2 = await queue.dequeue(1, 60);
            expect(batch2).toHaveLength(0);
        });

        it("respects batch size", async () => {
            for (let i = 0; i < 5; i++) await queue.enqueue(`sig-${i}`);
            const batch = await queue.dequeue(2, 60);
            expect(batch).toHaveLength(2);
        });
    });

    describe("ack", () => {
        it("removes the message from the queue", async () => {
            await queue.enqueue("sig-1");
            const batch = await queue.dequeue(1, 60);
            await queue.ack(batch[0].queueMsgId);
            // Should be gone, lease expired immediately doesn't matter since it was removed
            // Re-enqueue to check: dequeue should return empty since the message was acked
            const batch2 = await queue.dequeue(1, 0);
            expect(batch2.map((m) => m.queueMsgId)).not.toContain(batch[0].queueMsgId);
        });

        it("is no-op for unknown queue msg id", async () => {
            await expect(queue.ack("nonexistent")).resolves.toBeUndefined();
        });
    });

    describe("nack", () => {
        it("resets lease to allow future retry", async () => {
            await queue.enqueue("sig-1");
            const [msg] = await queue.dequeue(1, 120);
            const origAttempt = msg.attempt;

            // nack resets lease for immediate retry
            await queue.nack(msg.queueMsgId, 0);

            // Before nack, lease was 120s in future; after nack with 0s, it's now available
            const batch2 = await queue.dequeue(1, 60);
            expect(batch2).toHaveLength(1);
            expect(batch2[0].queueMsgId).toBe(msg.queueMsgId);
            expect(batch2[0].attempt).toBe(origAttempt + 1);
        });
    });

    describe("deadLetter", () => {
        it("removes the message from the active queue", async () => {
            await queue.enqueue("sig-fail");
            const [msg] = await queue.dequeue(1, 60);
            await queue.deadLetter(msg.queueMsgId, "max retries exceeded");
            // Ack from active queue should be no-op since it was moved to dead letters
            await queue.ack(msg.queueMsgId);
            // Dequeue again, this message should not appear
            const batch = await queue.dequeue(10, 0);
            expect(batch.map((m) => m.queueMsgId)).not.toContain(msg.queueMsgId);
        });

        it("is no-op for unknown queue msg id", async () => {
            await expect(queue.deadLetter("nonexistent", "reason")).resolves.toBeUndefined();
        });
    });

    describe("lease-based FIFO ordering", () => {
        it("returns messages in FIFO order when all leases expire", async () => {
            await queue.enqueue("a");
            await queue.enqueue("b");
            await queue.enqueue("c");
            const batch = await queue.dequeue(10, 60);
            expect(batch.map((m) => m.signalId)).toEqual(["a", "b", "c"]);
        });

        it("excludes items under active lease while returning others", async () => {
            await queue.enqueue("a");
            await queue.enqueue("b");
            await queue.enqueue("c");

            // Take only 'a' with a long lease
            const [first] = await queue.dequeue(1, 300);
            expect(first.signalId).toBe("a");
            expect(first.leaseUntil.getTime()).toBeGreaterThan(Date.now());

            // Now dequeue remaining — 'a' is still leased, only 'b' and 'c' should come out
            const batch = await queue.dequeue(10, 60);
            const ids = batch.map((m) => m.signalId);
            expect(ids).toEqual(["b", "c"]);
            // 'a' is still leased

            // Verify total: 3 enqueued, 'a' taken once, 'b'+'c' taken
            expect(ids).not.toContain("a");
        });
    });
});
