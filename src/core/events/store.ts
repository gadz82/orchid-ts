/** Persistence ABCs for signals, jobs, schedules, and trigger config. */
import type { Signal } from "./signal.js";
import type { JobRun } from "./job.js";
import type { DBTransaction } from "./queue.js";

export abstract class OrchidSignalStore {
    abstract insert(signal: Signal, tx?: DBTransaction | null): Promise<Signal>;
    abstract get(signalId: string): Promise<Signal | null>;
    abstract findByDedupe(source: string, dedupeKey: string | null): Promise<string | null>;
    abstract list(options?: {
        type?: string;
        tenantKey?: string;
        since?: Date;
        limit?: number;
    }): Promise<Signal[]>;
    abstract updateRelayStatus(signalId: string, status: string): Promise<void>;
}

export abstract class OrchidJobStore {
    abstract insert(run: JobRun): Promise<JobRun>;
    abstract update(run: JobRun): Promise<void>;
    abstract get(runId: string): Promise<JobRun | null>;
    abstract list(options?: {
        triggerId?: string;
        status?: string;
        statuses?: readonly string[];
        since?: Date;
        limit?: number;
        chatBindingChatId?: string;
    }): Promise<JobRun[]>;
    abstract latestAttempt(triggerId: string, signalId: string): Promise<number>;
    abstract findLatest(triggerId: string, signalId: string): Promise<JobRun | null>;
}

export interface OrchidScheduleRecord {
    scheduleId: string;
    triggerId: string;
    cron: string | null;
    intervalSeconds: number | null;
    identityClaim: Record<string, unknown>;
    lastFireAt: Date | null;
    nextFireAt: Date | null;
    enabled: boolean;
}

export abstract class OrchidScheduleStore {
    abstract upsert(record: OrchidScheduleRecord): Promise<void>;
    abstract get(scheduleId: string): Promise<OrchidScheduleRecord | null>;
    abstract list(): Promise<Iterable<OrchidScheduleRecord>>;
    abstract setEnabled(scheduleId: string, enabled: boolean): Promise<void>;
    abstract recordFire(
        scheduleId: string,
        lastFireAt: Date,
        nextFireAt: Date | null,
    ): Promise<void>;
}

export interface OrchidTriggerRecord {
    triggerId: string;
    version: number;
    config: Record<string, unknown>;
    createdAt: Date;
    deletedAt: Date | null;
}

export abstract class OrchidTriggerStore {
    abstract insertVersion(record: OrchidTriggerRecord): Promise<void>;
    abstract latest(triggerId: string): Promise<OrchidTriggerRecord | null>;
    abstract listActive(): Promise<Iterable<OrchidTriggerRecord>>;
    abstract softDelete(triggerId: string, deletedAt: Date): Promise<void>;
}
