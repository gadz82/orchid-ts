/** Signal emitter ABC. */
import type { SignalEnvelope, SignalIngestResult } from "./signal.js";

export abstract class OrchidSignalEmitter {
    abstract emit(envelope: SignalEnvelope): Promise<SignalIngestResult>;
}
