import { OrchidEventProducer } from "../../core/index.js";
import type { SignalEnvelope } from "../../core/index.js";
import type { InMemorySignalQueue } from "../queues/inmemory.js";

export class InternalEventProducer extends OrchidEventProducer {
    private _queue: InMemorySignalQueue;

    constructor(queue: InMemorySignalQueue) {
        super({} as any);
        this._queue = queue;
    }

    async produce(_event: SignalEnvelope): Promise<void> {
        const signalId = crypto.randomUUID();
        await this._queue.enqueue(signalId);
    }

    async start(): Promise<void> {}

    async stop(): Promise<void> {}
}
