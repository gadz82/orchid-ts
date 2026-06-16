import { OrchidEventRunner, JobStatus } from "../../core/index.js";
import type { JobRun } from "../../core/index.js";

export class GraphEventRunner extends OrchidEventRunner {
    private _graph: any;

    constructor(opts: { graph: any }) {
        super();
        this._graph = opts.graph;
    }

    async execute(run: JobRun): Promise<JobRun> {
        run.status = JobStatus.RUNNING;
        run.startedAt = new Date();

        try {
            const result = await this._graph.invoke({
                prompt: run.spec.prompt,
                agentName: run.spec.agentName,
                identityClaim: run.spec.identityClaim,
            });
            run.status = JobStatus.SUCCEEDED;
            run.result = result as Record<string, unknown>;
        } catch (err) {
            run.status = JobStatus.FAILED;
            run.error = err instanceof Error ? err.message : String(err);
        } finally {
            run.finishedAt = new Date();
        }

        return run;
    }
}
