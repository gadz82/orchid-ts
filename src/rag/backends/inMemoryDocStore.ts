import { OrchidDocStore } from "../../core/docStore.js";
import type { OrchidDocument } from "../../core/repository.js";

export class InMemoryDocStore extends OrchidDocStore {
    private store = new Map<string, OrchidDocument>();

    override async put(doc: OrchidDocument): Promise<void> {
        this.store.set(doc.id ?? `doc:${Date.now()}:${Math.random().toString(36).slice(2)}`, {
            ...doc,
            metadata: { ...(doc.metadata || {}) },
        });
    }

    override async get(docId: string): Promise<OrchidDocument | null> {
        const record = this.store.get(docId);
        if (!record) return null;
        return { ...record, metadata: { ...(record.metadata || {}) } };
    }

    override async getMany(docIds: string[]): Promise<OrchidDocument[]> {
        const results: OrchidDocument[] = [];
        for (const docId of docIds) {
            const record = this.store.get(docId);
            if (record) {
                results.push({ ...record, metadata: { ...(record.metadata || {}) } });
            }
        }
        return results;
    }
}
