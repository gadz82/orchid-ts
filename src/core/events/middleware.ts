/** Signal ingest middleware — transforms envelopes before they hit the dispatcher. */
import type { SignalEnvelope } from "./signal.js";

export abstract class SignalIngestMiddleware {
    abstract apply(envelope: SignalEnvelope): Promise<SignalEnvelope>;
}
