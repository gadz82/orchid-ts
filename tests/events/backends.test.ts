import { describe, it, expect, beforeEach } from "vitest";
import {
    InMemorySignalStore,
    InMemoryJobStore,
    InMemoryScheduleStore,
    InMemoryTriggerStore,
} from "../../src/events/backends/memory.js";
import type {
    Signal,
    JobRun,
    OrchidScheduleRecord,
    OrchidTriggerRecord,
} from "../../src/core/index.js";
import { JobStatus, RetryPolicy } from "../../src/core/index.js";

function makeSignal(overrides: Partial<Signal> = {}): Signal {
    const now = new Date();
    return {
        signalId: "sig-1",
        type: "test.event",
        payload: { key: "value" },
        source: "test-source",
        occurredAt: now,
        persistedAt: now,
        tenantKey: "t1",
        userId: "u1",
        correlationId: null,
        dedupeKey: "dedup-1",
        identityClaim: null,
        chatBinding: null,
        relayStatus: "committed",
        ...overrides,
    };
}

function makeJobRun(overrides: Partial<JobRun> = {}): JobRun {
    return {
        runId: "run-1",
        spec: {
            triggerId: "trig-1",
            signalId: "sig-1",
            agentName: "test-agent",
            prompt: "do thing",
            identityClaim: {},
            correlationId: null,
            parallelismKey: "default",
            visibility: "tenant",
            visibilityUserId: null,
            chatBinding: null,
            proactiveChat: false,
        },
        attemptNumber: 1,
        status: JobStatus.PENDING,
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
        nextRetryAt: null,
        metadata: {},
        ...overrides,
    };
}

function makeScheduleRecord(overrides: Partial<OrchidScheduleRecord> = {}): OrchidScheduleRecord {
    return {
        scheduleId: "sched-1",
        triggerId: "trig-1",
        cron: "*/5 * * * *",
        intervalSeconds: null,
        identityClaim: {},
        lastFireAt: null,
        nextFireAt: null,
        enabled: true,
        ...overrides,
    };
}

function makeTriggerRecord(overrides: Partial<OrchidTriggerRecord> = {}): OrchidTriggerRecord {
    return {
        triggerId: "trig-1",
        version: 1,
        config: { type: "event" },
        createdAt: new Date(),
        deletedAt: null,
        ...overrides,
    };
}

describe("InMemorySignalStore", () => {
    let store: InMemorySignalStore;

    beforeEach(() => {
        store = new InMemorySignalStore();
    });

    describe("insert / get", () => {
        it("inserts and retrieves a signal", async () => {
            const signal = makeSignal();
            await store.insert(signal);
            const found = await store.get("sig-1");
            expect(found).not.toBeNull();
            expect(found!.signalId).toBe("sig-1");
        });

        it("returns null for missing signal", async () => {
            const found = await store.get("nonexistent");
            expect(found).toBeNull();
        });
    });

    describe("findByDedupe", () => {
        it("finds signal by dedupe key", async () => {
            const signal = makeSignal({ signalId: "sig-1", source: "src-a", dedupeKey: "key-a" });
            await store.insert(signal);
            const found = await store.findByDedupe("src-a", "key-a");
            expect(found).toBe("sig-1");
        });

        it("returns null when no match", async () => {
            const found = await store.findByDedupe("unknown", "key");
            expect(found).toBeNull();
        });

        it("returns null for null dedupe key", async () => {
            const found = await store.findByDedupe("src", null);
            expect(found).toBeNull();
        });
    });

    describe("list", () => {
        it("returns all signals sorted by persistedAt desc", async () => {
            const s1 = makeSignal({ signalId: "sig-1", persistedAt: new Date("2024-01-01") });
            const s2 = makeSignal({ signalId: "sig-2", persistedAt: new Date("2024-06-01") });
            await store.insert(s1);
            await store.insert(s2);
            const list = await store.list();
            expect(list).toHaveLength(2);
            expect(list[0].signalId).toBe("sig-2");
        });

        it("filters by type", async () => {
            await store.insert(makeSignal({ signalId: "a", type: "alpha" }));
            await store.insert(makeSignal({ signalId: "b", type: "beta" }));
            await store.insert(makeSignal({ signalId: "c", type: "alpha" }));
            const list = await store.list({ type: "alpha" });
            expect(list).toHaveLength(2);
        });

        it("filters by tenantKey", async () => {
            await store.insert(makeSignal({ signalId: "a", tenantKey: "t1" }));
            await store.insert(makeSignal({ signalId: "b", tenantKey: "t2" }));
            const list = await store.list({ tenantKey: "t1" });
            expect(list).toHaveLength(1);
            expect(list[0].signalId).toBe("a");
        });

        it("respects limit", async () => {
            for (let i = 0; i < 5; i++) {
                await store.insert(makeSignal({ signalId: `sig-${i}` }));
            }
            const list = await store.list({ limit: 2 });
            expect(list).toHaveLength(2);
        });
    });

    describe("updateRelayStatus", () => {
        it("updates relay status on existing signal", async () => {
            await store.insert(makeSignal({ signalId: "sig-1", relayStatus: "committed" }));
            await store.updateRelayStatus("sig-1", "relayed");
            const found = await store.get("sig-1");
            expect(found!.relayStatus).toBe("relayed");
        });

        it("is no-op for missing signal", async () => {
            await expect(
                store.updateRelayStatus("nonexistent", "relayed"),
            ).resolves.toBeUndefined();
        });
    });
});

describe("InMemoryJobStore", () => {
    let store: InMemoryJobStore;

    beforeEach(() => {
        store = new InMemoryJobStore();
    });

    describe("insert / get / update", () => {
        it("inserts and retrieves a job run", async () => {
            const run = makeJobRun();
            await store.insert(run);
            const found = await store.get("run-1");
            expect(found).not.toBeNull();
            expect(found!.runId).toBe("run-1");
        });

        it("returns null for missing job run", async () => {
            const found = await store.get("missing");
            expect(found).toBeNull();
        });

        it("updates an existing job run", async () => {
            const run = makeJobRun({ status: JobStatus.PENDING });
            await store.insert(run);
            run.status = JobStatus.RUNNING;
            await store.update(run);
            const found = await store.get("run-1");
            expect(found!.status).toBe(JobStatus.RUNNING);
        });
    });

    describe("list", () => {
        it("filters by status", async () => {
            await store.insert(makeJobRun({ runId: "r1", status: JobStatus.PENDING }));
            await store.insert(makeJobRun({ runId: "r2", status: JobStatus.SUCCEEDED }));
            await store.insert(makeJobRun({ runId: "r3", status: JobStatus.PENDING }));
            const list = await store.list({ status: JobStatus.PENDING });
            expect(list).toHaveLength(2);
        });

        it("filters by triggerId", async () => {
            await store.insert(makeJobRun({ runId: "r1" }));
            await store.insert(
                makeJobRun({
                    runId: "r2",
                    spec: { ...makeJobRun().spec, triggerId: "trig-b" },
                }),
            );
            const list = await store.list({ triggerId: "trig-1" });
            expect(list).toHaveLength(1);
        });
    });

    describe("latestAttempt", () => {
        it("returns max attempt number for trigger+signal pair", async () => {
            await store.insert(makeJobRun({ runId: "r1", attemptNumber: 1 }));
            await store.insert(makeJobRun({ runId: "r2", attemptNumber: 3 }));
            await store.insert(
                makeJobRun({
                    runId: "r3",
                    attemptNumber: 5,
                    spec: { ...makeJobRun().spec, signalId: "sig-other" },
                }),
            );
            const max = await store.latestAttempt("trig-1", "sig-1");
            expect(max).toBe(3);
        });

        it("returns 0 when no runs exist", async () => {
            const max = await store.latestAttempt("unknown", "unknown");
            expect(max).toBe(0);
        });
    });

    describe("findLatest", () => {
        it("returns run with highest attempt number", async () => {
            await store.insert(makeJobRun({ runId: "r1", attemptNumber: 1 }));
            await store.insert(makeJobRun({ runId: "r2", attemptNumber: 3 }));
            const latest = await store.findLatest("trig-1", "sig-1");
            expect(latest).not.toBeNull();
            expect(latest!.runId).toBe("r2");
        });
    });
});

describe("InMemoryScheduleStore", () => {
    let store: InMemoryScheduleStore;

    beforeEach(() => {
        store = new InMemoryScheduleStore();
    });

    describe("upsert / get", () => {
        it("upserts and retrieves a schedule record", async () => {
            const rec = makeScheduleRecord();
            await store.upsert(rec);
            const found = await store.get("sched-1");
            expect(found).not.toBeNull();
            expect(found!.cron).toBe("*/5 * * * *");
        });

        it("returns null for missing record", async () => {
            const found = await store.get("missing");
            expect(found).toBeNull();
        });
    });

    describe("list", () => {
        it("returns all records", async () => {
            await store.upsert(makeScheduleRecord({ scheduleId: "s1" }));
            await store.upsert(makeScheduleRecord({ scheduleId: "s2" }));
            const records: OrchidScheduleRecord[] = [];
            for await (const r of await store.list()) records.push(r);
            expect(records).toHaveLength(2);
        });
    });

    describe("setEnabled", () => {
        it("updates enabled flag", async () => {
            await store.upsert(makeScheduleRecord({ scheduleId: "s1", enabled: true }));
            await store.setEnabled("s1", false);
            const found = await store.get("s1");
            expect(found!.enabled).toBe(false);
        });
    });

    describe("recordFire", () => {
        it("updates last fire and next fire timestamps", async () => {
            await store.upsert(makeScheduleRecord({ scheduleId: "s1" }));
            const last = new Date("2024-06-01");
            const next = new Date("2024-06-02");
            await store.recordFire("s1", last, next);
            const found = await store.get("s1");
            expect(found!.lastFireAt).toEqual(last);
            expect(found!.nextFireAt).toEqual(next);
        });
    });
});

describe("InMemoryTriggerStore", () => {
    let store: InMemoryTriggerStore;

    beforeEach(() => {
        store = new InMemoryTriggerStore();
    });

    describe("insertVersion / latest", () => {
        it("stores and retrieves the latest version", async () => {
            await store.insertVersion(makeTriggerRecord({ triggerId: "t1", version: 1 }));
            await store.insertVersion(makeTriggerRecord({ triggerId: "t1", version: 2 }));
            const latest = await store.latest("t1");
            expect(latest).not.toBeNull();
            expect(latest!.version).toBe(2);
        });

        it("returns null for unknown trigger", async () => {
            const latest = await store.latest("unknown");
            expect(latest).toBeNull();
        });
    });

    describe("listActive", () => {
        it("returns only non-deleted latest versions", async () => {
            await store.insertVersion(makeTriggerRecord({ triggerId: "t1", version: 1 }));
            await store.insertVersion(
                makeTriggerRecord({ triggerId: "t2", version: 1, deletedAt: new Date() }),
            );
            const active: OrchidTriggerRecord[] = [];
            for await (const r of await store.listActive()) active.push(r);
            expect(active).toHaveLength(1);
            expect(active[0].triggerId).toBe("t1");
        });

        it("excludes soft-deleted triggers", async () => {
            await store.insertVersion(makeTriggerRecord({ triggerId: "t1", version: 1 }));
            await store.softDelete("t1", new Date());
            const active: OrchidTriggerRecord[] = [];
            for await (const r of await store.listActive()) active.push(r);
            expect(active).toHaveLength(0);
        });
    });

    describe("softDelete", () => {
        it("sets deletedAt on the latest version", async () => {
            await store.insertVersion(makeTriggerRecord({ triggerId: "t1", version: 1 }));
            const delDate = new Date();
            await store.softDelete("t1", delDate);
            const latest = await store.latest("t1");
            expect(latest!.deletedAt).toEqual(delDate);
        });

        it("is no-op for unknown trigger", async () => {
            await expect(store.softDelete("unknown", new Date())).resolves.toBeUndefined();
        });
    });
});
