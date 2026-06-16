export enum OrchidStreamEventType {
    CHUNK = "chunk",
    TOKEN = "token",
    TOOL_START = "tool_start",
    TOOL_END = "tool_end",
    AGENT_START = "agent_start",
    AGENT_END = "agent_end",
    MINI_AGENT_EVENT = "mini_agent_event",
    ERROR = "error",
    DONE = "done",
}

export interface OrchidStreamEvent {
    type: OrchidStreamEventType;
    data: Record<string, unknown>;
    timestamp: number;
}

export function createStreamEvent(
    type: OrchidStreamEventType,
    data: Record<string, unknown>,
): OrchidStreamEvent {
    return {
        type,
        data,
        timestamp: Date.now(),
    };
}

export function isTerminalEvent(type: OrchidStreamEventType): boolean {
    return type === OrchidStreamEventType.DONE || type === OrchidStreamEventType.ERROR;
}

export function eventToSSE(event: OrchidStreamEvent): string {
    const eventName = event.type === OrchidStreamEventType.ERROR ? "error" : "message";
    return `event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`;
}
