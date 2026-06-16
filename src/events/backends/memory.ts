import {
    OrchidSignalStore,
    OrchidJobStore,
    OrchidScheduleStore,
    OrchidTriggerStore,
} from "../../core/index.js";
import type {
    Signal,
    JobRun,
    OrchidScheduleRecord,
    OrchidTriggerRecord,
} from "../../core/index.js";

export class InMemorySignalStore extends OrchidSignalStore {
    private _signals: Map<string, Signal> = new Map();
    private _dedupeIndex: Map<string, string> = new Map();

    async insert(signal: Signal): Promise<Signal> {
        this._signals.set(signal.signalId, signal);
        const dedupeKey = this._dedupeDbKey(signal.source, signal.dedupeKey);
        if (dedupeKey !== null) {
            this._dedupeIndex.set(dedupeKey, signal.signalId);
        }
        return signal;
    }

    async get(signalId: string): Promise<Signal | null> {
        return this._signals.get(signalId) ?? null;
    }

    async findByDedupe(source: string, dedupeKey: string | null): Promise<string | null> {
        if (dedupeKey === null) return null;
        const key = `${source}::${dedupeKey}`;
        return this._dedupeIndex.get(key) ?? null;
    }

    async list(options?: {
        type?: string;
        tenantKey?: string;
        since?: Date;
        limit?: number;
    }): Promise<Signal[]> {
        let results = Array.from(this._signals.values());

        if (options?.type) {
            results = results.filter((s) => s.type === options.type);
        }
        if (options?.tenantKey) {
            results = results.filter((s) => s.tenantKey === options.tenantKey);
        }
        if (options?.since) {
            results = results.filter((s) => s.persistedAt >= options.since!);
        }

        results.sort((a, b) => b.persistedAt.getTime() - a.persistedAt.getTime());

        if (options?.limit && options.limit > 0) {
            results = results.slice(0, options.limit);
        }

        return results;
    }

    async updateRelayStatus(signalId: string, status: string): Promise<void> {
        const signal = this._signals.get(signalId);
        if (signal) {
            signal.relayStatus = status;
        }
    }

    private _dedupeDbKey(source: string, dedupeKey: string | null): string | null {
        if (dedupeKey === null) return null;
        return `${source}::${dedupeKey}`;
    }
}

export class InMemoryJobStore extends OrchidJobStore {
    private _runs: Map<string, JobRun> = new Map();

    async insert(run: JobRun): Promise<JobRun> {
        this._runs.set(run.runId, run);
        return run;
    }

    async update(run: JobRun): Promise<void> {
        this._runs.set(run.runId, run);
    }

    async get(runId: string): Promise<JobRun | null> {
        return this._runs.get(runId) ?? null;
    }

    async list(options?: {
        triggerId?: string;
        status?: string;
        statuses?: readonly string[];
        since?: Date;
        limit?: number;
        chatBindingChatId?: string;
    }): Promise<JobRun[]> {
        let results = Array.from(this._runs.values());

        if (options?.triggerId) {
            results = results.filter((r) => r.spec.triggerId === options.triggerId);
        }
        if (options?.status) {
            results = results.filter((r) => r.status === options.status);
        }
        if (options?.statuses && options.statuses.length > 0) {
            results = results.filter((r) => options.statuses!.includes(r.status));
        }
        if (options?.since) {
            results = results.filter((r) => r.queuedAt >= options.since!);
        }
        if (options?.chatBindingChatId) {
            results = results.filter(
                (r) =>
                    r.spec.chatBinding &&
                    (r.spec.chatBinding as Record<string, unknown>).chatId ===
                        options.chatBindingChatId,
            );
        }

        results.sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime());

        if (options?.limit && options.limit > 0) {
            results = results.slice(0, options.limit);
        }

        return results;
    }

    async latestAttempt(triggerId: string, signalId: string): Promise<number> {
        let max = 0;
        for (const run of this._runs.values()) {
            if (run.spec.triggerId === triggerId && run.spec.signalId === signalId) {
                if (run.attemptNumber > max) max = run.attemptNumber;
            }
        }
        return max;
    }

    async findLatest(triggerId: string, signalId: string): Promise<JobRun | null> {
        let latest: JobRun | null = null;
        for (const run of this._runs.values()) {
            if (run.spec.triggerId === triggerId && run.spec.signalId === signalId) {
                if (!latest || run.attemptNumber > latest.attemptNumber) {
                    latest = run;
                }
            }
        }
        return latest;
    }
}

export class InMemoryScheduleStore extends OrchidScheduleStore {
    private _schedules: Map<string, OrchidScheduleRecord> = new Map();

    async upsert(record: OrchidScheduleRecord): Promise<void> {
        this._schedules.set(record.scheduleId, record);
    }

    async get(scheduleId: string): Promise<OrchidScheduleRecord | null> {
        return this._schedules.get(scheduleId) ?? null;
    }

    async list(): Promise<Iterable<OrchidScheduleRecord>> {
        return Array.from(this._schedules.values());
    }

    async setEnabled(scheduleId: string, enabled: boolean): Promise<void> {
        const record = this._schedules.get(scheduleId);
        if (record) {
            record.enabled = enabled;
        }
    }

    async recordFire(scheduleId: string, lastFireAt: Date, nextFireAt: Date | null): Promise<void> {
        const record = this._schedules.get(scheduleId);
        if (record) {
            record.lastFireAt = lastFireAt;
            record.nextFireAt = nextFireAt;
        }
    }
}

export class InMemoryTriggerStore extends OrchidTriggerStore {
    private _triggers: Map<string, OrchidTriggerRecord[]> = new Map();

    async insertVersion(record: OrchidTriggerRecord): Promise<void> {
        const versions = this._triggers.get(record.triggerId) ?? [];
        versions.push(record);
        this._triggers.set(record.triggerId, versions);
    }

    async latest(triggerId: string): Promise<OrchidTriggerRecord | null> {
        const versions = this._triggers.get(triggerId);
        if (!versions || versions.length === 0) return null;
        return versions.reduce((latest, current) =>
            current.version > latest.version ? current : latest,
        );
    }

    async listActive(): Promise<Iterable<OrchidTriggerRecord>> {
        const active: OrchidTriggerRecord[] = [];
        for (const versions of this._triggers.values()) {
            const latest = versions.reduce((best, current) =>
                current.version > best.version ? current : best,
            );
            if (latest.deletedAt === null) {
                active.push(latest);
            }
        }
        return active;
    }

    async softDelete(triggerId: string, deletedAt: Date): Promise<void> {
        const versions = this._triggers.get(triggerId);
        if (!versions || versions.length === 0) return;
        const latest = versions.reduce((best, current) =>
            current.version > best.version ? current : best,
        );
        latest.deletedAt = deletedAt;
    }
}
