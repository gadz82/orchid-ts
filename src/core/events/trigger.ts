/** Trigger ABC — maps signals to job specs. */
import type { Signal } from "./signal.js";
import type { JobSpec, RetryPolicy } from "./job.js";

export abstract class OrchidTrigger {
    abstract get triggerId(): string;

    abstract get parallelism(): string;

    abstract get retryPolicy(): RetryPolicy;

    abstract get identityClaim(): Record<string, object>;

    abstract matches(signal: Signal): boolean;

    abstract buildJobSpec(signal: Signal): JobSpec;
}

export abstract class TriggerRegistry {
    abstract register(trigger: OrchidTrigger): void;
    abstract findMatches(signal: Signal): Iterable<OrchidTrigger>;
    abstract get(triggerId: string): OrchidTrigger | null;
    abstract all(): Iterable<OrchidTrigger>;
}
