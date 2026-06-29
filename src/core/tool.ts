/** Tool ABC for framework tools. */

export interface OrchidToolInput {
    parameters: Record<string, unknown>;
    query?: string | null;
    context?: Record<string, unknown> | null;
    authContext?: unknown;
    contentSources?: unknown;
}

export class OrchidToolOutput {
    result: unknown;
    metadata: Record<string, unknown>;

    constructor(result: unknown = null, metadata: Record<string, unknown> = {}) {
        this.result = result;
        this.metadata = metadata;
    }
}

export abstract class OrchidTool {
    name = "";
    description = "";
    parametersSchema: Record<string, unknown> = { type: "object", properties: {} };

    requiresApproval = false;
    parallelSafe = false;
    injectToRag = false;
    ragTtl: number | null = null;
    ragOverrides: unknown = null;

    abstract invoke(toolInput: OrchidToolInput): Promise<OrchidToolOutput>;

    getParametersSchema(): Record<string, unknown> {
        return JSON.parse(
            JSON.stringify(this.parametersSchema || { type: "object", properties: {} }),
        );
    }

    getLLMFunctionSchema(): Record<string, unknown> {
        return {
            type: "function",
            function: {
                name: this.name,
                description: this.description,
                parameters: this.getParametersSchema(),
            },
        };
    }
}

/**
 * Concrete OrchidTool that wraps a plain handler function.
 *
 * Example YAML:
 *   tools:
 *     my_tool:
 *       handler: "./tools/example.js#myFn"
 *       description: "Does something"
 *       parameters:
 *         query: { type: string, description: "search query" }
 */
export class HandlerTool extends OrchidTool {
    private _fn: (args: Record<string, unknown>) => string | Promise<string>;

    constructor(opts: {
        name: string;
        fn: (args: Record<string, unknown>) => string | Promise<string>;
        description: string;
        properties: Record<string, unknown>;
        required?: string[];
        requiresApproval?: boolean;
        parallelSafe?: boolean;
        injectToRag?: boolean;
        ragTtl?: number | null;
    }) {
        super();
        this.name = opts.name;
        this._fn = opts.fn;
        this.description = opts.description;
        this.parametersSchema = {
            type: "object",
            properties: opts.properties,
            required: opts.required ?? [],
        };
        this.requiresApproval = opts.requiresApproval ?? false;
        this.parallelSafe = opts.parallelSafe ?? false;
        this.injectToRag = opts.injectToRag ?? false;
        this.ragTtl = opts.ragTtl ?? null;
    }

    override async invoke(toolInput: OrchidToolInput): Promise<OrchidToolOutput> {
        // Normalise camelCase keys back to snake_case so handler
        // functions that reference args.player_name (Python convention)
        // receive the value regardless of whether the caller used
        // playerName or player_name.
        const normalised: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(toolInput.parameters)) {
            const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
            normalised[snakeKey] = value;
        }
        // Always include query and context so handler functions can
        // extract what they need even when parameters are empty.
        if (toolInput.query) {
            normalised["query"] = toolInput.query;
        }
        if (toolInput.context) {
            normalised["context"] = toolInput.context;
        }
        const rawResult = await this._fn(normalised);
        // Serialize objects so the LLM sees structured data (matching
        // Python's behaviour where tools return dicts).
        const result = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult, null, 2);
        return new OrchidToolOutput(result);
    }
}
