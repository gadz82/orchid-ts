/** Job-side value objects for the Pollen + Bloom event system. */

export enum JobStatus {
    PENDING = "pending",
    RUNNING = "running",
    SUCCEEDED = "succeeded",
    FAILED = "failed",
    CANCELLED = "cancelled",
    RETRY_SCHEDULED = "retry_scheduled",
}

export class RetryPolicy {
    maxAttempts: number;
    backoff: string;
    jitter: boolean;
    initialDelaySeconds: number;
    maxDelaySeconds: number;

    constructor({
        maxAttempts = 0,
        backoff = "exponential",
        jitter = true,
        initialDelaySeconds = 1.0,
        maxDelaySeconds = 300.0,
    }: {
        maxAttempts?: number;
        backoff?: string;
        jitter?: boolean;
        initialDelaySeconds?: number;
        maxDelaySeconds?: number;
    } = {}) {
        this.maxAttempts = maxAttempts;
        this.backoff = backoff;
        this.jitter = jitter;
        this.initialDelaySeconds = initialDelaySeconds;
        this.maxDelaySeconds = maxDelaySeconds;
    }

    delayFor(attempt: number): number {
        const base = this._computeBase(attempt);
        const capped = Math.min(base, this.maxDelaySeconds);
        return this.jitter ? capped * 0.75 : capped;
    }

    private _computeBase(attempt: number): number {
        const a = Math.max(1, attempt);
        switch (this.backoff) {
            case "fixed":
                return this.initialDelaySeconds;
            case "linear":
                return this.initialDelaySeconds * a;
            default:
                return this.initialDelaySeconds * Math.pow(2, a - 1);
        }
    }
}

export interface JobSpec {
    readonly triggerId: string;
    readonly signalId: string;
    readonly agentName: string;
    readonly prompt: string;
    readonly identityClaim: Record<string, unknown>;
    readonly correlationId: string | null;
    readonly parallelismKey: string;
    readonly visibility: string;
    readonly visibilityUserId: string | null;
    readonly chatBinding: Record<string, unknown> | null;
    readonly proactiveChat: boolean;
}

export interface JobRun {
    runId: string;
    spec: JobSpec;
    attemptNumber: number;
    status: JobStatus;
    queuedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    result: Record<string, unknown> | null;
    error: string | null;
    nextRetryAt: Date | null;
    metadata: Record<string, unknown>;
}
