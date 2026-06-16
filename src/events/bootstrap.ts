import type { OrchidRuntime } from "../orchid/runtime.js";
import { InMemorySignalStore, InMemoryJobStore } from "./backends/memory.js";
import { InMemorySignalQueue } from "./queues/inmemory.js";
import { GraphEventRunner } from "./runners/graphRunner.js";
import { CronScheduler } from "./schedulers/cronScheduler.js";

export async function bootstrapEvents(_runtime: OrchidRuntime): Promise<{
    signalStore: InMemorySignalStore;
    jobStore: InMemoryJobStore;
    queue: InMemorySignalQueue;
    runner: GraphEventRunner;
    scheduler: CronScheduler;
}> {
    const signalStore = new InMemorySignalStore();
    const jobStore = new InMemoryJobStore();
    const queue = new InMemorySignalQueue();
    const runner = new GraphEventRunner({ graph: null });
    const scheduler = new CronScheduler();

    return { signalStore, jobStore, queue, runner, scheduler };
}
