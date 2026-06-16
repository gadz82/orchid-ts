/** In-memory store for pending HITL interrupts. */
import type { ToolApprovalPayload } from "./graphInterrupt.js";

class PendingInterruptStore {
    private store = new Map<string, ToolApprovalPayload>();

    set(threadId: string, payload: ToolApprovalPayload): void {
        this.store.set(threadId, payload);
    }

    get(threadId: string): ToolApprovalPayload | undefined {
        return this.store.get(threadId);
    }

    delete(threadId: string): boolean {
        return this.store.delete(threadId);
    }

    clear(): void {
        this.store.clear();
    }
}

export const globalPendingInterrupts = new PendingInterruptStore();
