/** Event producer ABC — creates SignalEnvelopes from external stimuli. */
import type { OrchidSignalEmitter } from "./emitter.js";

export abstract class OrchidEventProducer {
    protected emitter: OrchidSignalEmitter;

    constructor(emitter: OrchidSignalEmitter) {
        this.emitter = emitter;
    }

    abstract start(): Promise<void>;
    abstract stop(): Promise<void>;
}
