/** Signal dispatcher ABC — ingests envelopes into the persistent store + queue. */
import type { SignalEnvelope, SignalIngestResult } from "./signal.js";
import type { OrchidSignalStore } from "./store.js";
import type { OrchidSignalQueue } from "./queue.js";
import type { SignalIngestMiddleware } from "./middleware.js";
import { signalFromEnvelope } from "./signal.js";

export abstract class OrchidEventDispatcher {
    abstract ingest(envelope: SignalEnvelope): Promise<SignalIngestResult>;
}

export class DefaultSignalDispatcher implements OrchidEventDispatcher {
    private _store: OrchidSignalStore;
    private _queue: OrchidSignalQueue;
    private _middleware: SignalIngestMiddleware[];

    constructor({
        store,
        queue,
        middleware,
    }: {
        store: OrchidSignalStore;
        queue: OrchidSignalQueue;
        middleware?: SignalIngestMiddleware[];
    }) {
        this._store = store;
        this._queue = queue;
        this._middleware = middleware ?? [];
    }

    async ingest(envelope: SignalEnvelope): Promise<SignalIngestResult> {
        let current = envelope;
        for (const mw of this._middleware) {
            current = await mw.apply(current);
        }
        const signalId = crypto.randomUUID();
        const persistedAt = new Date();
        const signal = signalFromEnvelope(current, signalId, persistedAt);
        await this._store.insert(signal);
        const queueMsgId = await this._queue.enqueue(signalId);
        return { signalId, queueMsgId, deduplicated: false };
    }
}
