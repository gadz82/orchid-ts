type EventHandler = (...args: unknown[]) => unknown;
const EVENT_TYPE_REGISTRY: Map<string, { schema: any; handler: EventHandler }> = new Map();

export function registerEventType(name: string, schema: any, handler: EventHandler): void {
    if (EVENT_TYPE_REGISTRY.has(name)) {
        throw new Error(`Event type '${name}' is already registered`);
    }
    EVENT_TYPE_REGISTRY.set(name, { schema, handler });
}

export function getEventType(name: string): { schema: any; handler: EventHandler } | null {
    return EVENT_TYPE_REGISTRY.get(name) ?? null;
}

export function listEventTypes(): string[] {
    return Array.from(EVENT_TYPE_REGISTRY.keys());
}

export function unregisterEventType(name: string): boolean {
    return EVENT_TYPE_REGISTRY.delete(name);
}

export function clearEventRegistry(): void {
    EVENT_TYPE_REGISTRY.clear();
}
