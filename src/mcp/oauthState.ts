/**
 * OAuth state store — in-memory implementation for MCP OAuth flow
 * state parameter persistence. State is short-lived (typ. 5–10 min).
 */
export interface OrchidOAuthStateStore {
    getState(state: string): Promise<Record<string, unknown> | null>;
    setState(state: string, data: Record<string, unknown>): Promise<void>;
    deleteState(state: string): Promise<void>;
}

export class InMemoryOAuthStateStore implements OrchidOAuthStateStore {
    private store = new Map<string, Record<string, unknown>>();

    get size(): number {
        return this.store.size;
    }

    async getState(state: string): Promise<Record<string, unknown> | null> {
        return this.store.get(state) ?? null;
    }

    async setState(state: string, data: Record<string, unknown>): Promise<void> {
        this.store.set(state, data);
    }

    async deleteState(state: string): Promise<void> {
        this.store.delete(state);
    }

    clear(): void {
        this.store.clear();
    }
}
