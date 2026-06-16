/** Signal processor ABC. */
import type { QueuedSignal } from "./queue.js";

export abstract class OrchidEventProcessor {
    abstract process(batch: QueuedSignal[]): Promise<void>;
}
