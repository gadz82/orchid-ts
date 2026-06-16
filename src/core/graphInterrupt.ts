/** HITL (Human-in-the-Loop) interrupt for tool approval. */

export interface ToolApprovalPayload {
    toolName: string;
    arguments: Record<string, unknown>;
    agentName: string;
    reason?: string;
}

export class GraphInterrupt extends Error {
    interruptValue: ToolApprovalPayload;

    constructor(interruptValue: ToolApprovalPayload) {
        super(`Graph interrupted for tool approval: ${interruptValue.toolName}`);
        this.name = "GraphInterrupt";
        this.interruptValue = interruptValue;
    }
}

export function isGraphInterrupt(error: unknown): error is GraphInterrupt {
    return error instanceof GraphInterrupt;
}
