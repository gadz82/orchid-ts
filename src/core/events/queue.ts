/** Durable signal queue ABC. */

export interface QueuedSignal {
    queueMsgId: string;
    signalId: string;
    enqueuedAt: Date;
    leaseUntil: Date;
    attempt: number;
    payloadHint: Record<string, unknown> | null;
}

export abstract class DBTransaction {
    // Opaque transaction handle — concrete backends wrap connection objects
}

export abstract class OrchidSignalQueue {
    abstract enqueue(
        signalId: string,
        options?: { priority?: number; tx?: DBTransaction | null },
    ): Promise<string>;

    abstract dequeue(batchSize: number, leaseSeconds: number): Promise<QueuedSignal[]>;

    abstract ack(queueMsgId: string): Promise<void>;
    abstract nack(queueMsgId: string, retryAfterSeconds: number): Promise<void>;
    abstract deadLetter(queueMsgId: string, reason: string): Promise<void>;
}
