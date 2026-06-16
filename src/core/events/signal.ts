/** Immutable signal value objects for the Pollen + Bloom event system. */

export interface SignalEnvelope {
    type: string;
    payload: Record<string, unknown>;
    source: string;
    occurredAt: Date;
    tenantKey: string;
    userId: string | null;
    correlationId: string | null;
    dedupeKey: string | null;
    identityClaim: Record<string, unknown> | null;
    chatBinding: Record<string, unknown> | null;
}

export interface Signal {
    type: string;
    payload: Record<string, unknown>;
    source: string;
    occurredAt: Date;
    tenantKey: string;
    signalId: string;
    persistedAt: Date;
    userId: string | null;
    correlationId: string | null;
    dedupeKey: string | null;
    identityClaim: Record<string, unknown> | null;
    chatBinding: Record<string, unknown> | null;
    relayStatus: string;
}

export interface SignalIngestResult {
    signalId: string;
    queueMsgId: string | null;
    deduplicated: boolean;
}

export function signalFromEnvelope(
    envelope: SignalEnvelope,
    signalId: string,
    persistedAt: Date,
    relayStatus = "committed",
): Signal {
    return {
        type: envelope.type,
        payload: { ...envelope.payload },
        source: envelope.source,
        occurredAt: envelope.occurredAt,
        tenantKey: envelope.tenantKey,
        signalId,
        persistedAt,
        userId: envelope.userId ?? null,
        correlationId: envelope.correlationId ?? null,
        dedupeKey: envelope.dedupeKey ?? null,
        identityClaim: envelope.identityClaim ? { ...envelope.identityClaim } : null,
        chatBinding: envelope.chatBinding ? { ...envelope.chatBinding } : null,
        relayStatus,
    };
}
