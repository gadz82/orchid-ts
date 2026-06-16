/**
 * FunctionTool — wraps an arbitrary async function as an OrchidTool.
 *
 * The simplest way to add a callable tool to the framework without
 * subclassing OrchidTool.  The wrapped function receives the full
 * OrchidToolInput and must return an OrchidToolOutput.
 */

import { OrchidTool, OrchidToolOutput } from "../core/tool.js";
import type { OrchidToolInput } from "../core/tool.js";

export type ToolFunction = (input: OrchidToolInput) => Promise<OrchidToolOutput>;

export interface FunctionToolOptions {
    fn: ToolFunction;
    name: string;
    description?: string;
    parametersSchema?: Record<string, unknown> | null;
}

export class FunctionTool extends OrchidTool {
    private _fn: ToolFunction;

    constructor(opts: FunctionToolOptions) {
        super();
        this.name = opts.name;
        this.description = opts.description ?? "";
        this._fn = opts.fn;

        if (opts.parametersSchema != null) {
            this.parametersSchema = opts.parametersSchema;
        }
    }

    get parameters(): Record<string, unknown> {
        return this.getParametersSchema();
    }

    async invoke(toolInput: OrchidToolInput): Promise<OrchidToolOutput> {
        return this._fn(toolInput);
    }
}
