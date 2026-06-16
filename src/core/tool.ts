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
