import { OrchidSignalQueue, DBTransaction } from "../../core/index.js";
import type { QueuedSignal } from "../../core/index.js";

export class InMemorySignalQueue extends OrchidSignalQueue {
    private _queue: QueuedSignal[] = [];
    private _deadLetters: Array<{ msg: QueuedSignal; reason: string }> = [];

    async enqueue(
        signalId: string,
        options?: { priority?: number; tx?: DBTransaction | null },
    ): Promise<string> {
        const queueMsgId = crypto.randomUUID();
        const now = new Date();
        const msg: QueuedSignal = {
            queueMsgId,
            signalId,
            enqueuedAt: now,
            leaseUntil: now,
            attempt: 0,
            payloadHint: null,
        };

        if (options?.priority && options.priority > 0) {
            this._queue.unshift(msg);
        } else {
            this._queue.push(msg);
        }

        return queueMsgId;
    }

    async dequeue(batchSize: number, leaseSeconds: number): Promise<QueuedSignal[]> {
        const now = new Date();
        const available = this._queue.filter((m) => m.leaseUntil <= now);
        const batch = available.slice(0, batchSize);

        const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
        for (const msg of batch) {
            msg.leaseUntil = leaseUntil;
            msg.attempt += 1;
        }

        return batch;
    }

    async ack(queueMsgId: string): Promise<void> {
        const idx = this._queue.findIndex((m) => m.queueMsgId === queueMsgId);
        if (idx !== -1) {
            this._queue.splice(idx, 1);
        }
    }

    async nack(queueMsgId: string, retryAfterSeconds: number): Promise<void> {
        const msg = this._queue.find((m) => m.queueMsgId === queueMsgId);
        if (msg) {
            msg.leaseUntil = new Date(Date.now() + retryAfterSeconds * 1000);
        }
    }

    async deadLetter(queueMsgId: string, reason: string): Promise<void> {
        const idx = this._queue.findIndex((m) => m.queueMsgId === queueMsgId);
        if (idx !== -1) {
            const [msg] = this._queue.splice(idx, 1);
            this._deadLetters.push({ msg, reason });
        }
    }
}
