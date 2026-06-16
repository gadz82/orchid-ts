import type { SignalEnvelope } from "../../core/index.js";

export interface ScheduleJob {
    id: string;
    cronExpression: string;
    signalTemplate: SignalEnvelope;
    enabled: boolean;
}

export class CronScheduler {
    private _jobs: Map<string, ScheduleJob> = new Map();

    addJob(job: ScheduleJob): void {
        this._jobs.set(job.id, job);
    }

    removeJob(id: string): void {
        this._jobs.delete(id);
    }

    enableJob(id: string): void {
        const job = this._jobs.get(id);
        if (job) {
            job.enabled = true;
        }
    }

    disableJob(id: string): void {
        const job = this._jobs.get(id);
        if (job) {
            job.enabled = false;
        }
    }

    getJobs(): ScheduleJob[] {
        return Array.from(this._jobs.values());
    }

    getEnabledJobs(): ScheduleJob[] {
        return Array.from(this._jobs.values()).filter((j) => j.enabled);
    }

    getJob(id: string): ScheduleJob | undefined {
        return this._jobs.get(id);
    }
}
