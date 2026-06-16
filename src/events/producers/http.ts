import { OrchidEventProducer } from "../../core/index.js";
import type { OrchidSignalEmitter } from "../../core/index.js";
import type { SignalEnvelope } from "../../core/index.js";

export class HttpEventProducer extends OrchidEventProducer {
    private _endpoint: string;
    private _headers: Record<string, string>;
    private _abortController: AbortController | null = null;

    constructor(opts: {
        endpoint: string;
        headers?: Record<string, string>;
        emitter?: OrchidSignalEmitter;
    }) {
        super(opts.emitter ?? ({} as OrchidSignalEmitter));
        this._endpoint = opts.endpoint;
        this._headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
    }

    async produce(event: SignalEnvelope): Promise<void> {
        const body = JSON.stringify({
            type: event.type,
            payload: event.payload,
            source: event.source,
            occurredAt: event.occurredAt.toISOString(),
            tenantKey: event.tenantKey,
            userId: event.userId,
            correlationId: event.correlationId,
            dedupeKey: event.dedupeKey,
            identityClaim: event.identityClaim,
            chatBinding: event.chatBinding,
        });

        const response = await fetch(this._endpoint, {
            method: "POST",
            headers: this._headers,
            body,
            signal: this._abortController?.signal,
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`HTTP event producer failed: ${response.status} ${text}`);
        }
    }

    async start(): Promise<void> {
        this._abortController = new AbortController();
    }

    async stop(): Promise<void> {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }
}
