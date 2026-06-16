// GraphState serves as the LangGraph state schema with reducers.
// All keys are treated as optional (total=False in Python TypedDict).
// Inspired by Python's GraphState from graph/state.py but kept as
// a standalone interface for maximum compatibility with reducers.
export interface GraphState {
    messages?: unknown[];
    chatId?: string;
    activeAgents?: string[];
    mcpContext?: Record<string, unknown>;
    ragContext?: Record<string, unknown>;
    finalResponse?: string | null;
    pendingAgents?: string[];
    executionMode?: "parallel" | "sequential";
    skillInstructions?: Record<string, unknown>;
    hasOutputGuardrails?: boolean;
    mcpAuthStatus?: Record<string, unknown>;
    miniAgentDecisions?: Record<string, unknown>;
    miniAgentOutcomes?: Record<string, unknown>;
    activeMiniParent?: string;
    activeMiniId?: string;
    activeMiniSubtask?: Record<string, unknown>;
    activeMiniToolSubset?: string[];
}
