/** Event runner ABC — executes jobs. */
import type { JobRun } from "./job.js";

export abstract class OrchidEventRunner {
    abstract execute(run: JobRun): Promise<JobRun>;
}
