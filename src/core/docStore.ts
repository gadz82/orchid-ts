/** Document Store ABC — stores parent documents referenced by vector chunks. */
import type { OrchidDocument } from "./repository.js";

export abstract class OrchidDocStore {
    abstract put(doc: OrchidDocument): Promise<void>;
    abstract get(docId: string): Promise<OrchidDocument | null>;
    abstract getMany(docIds: string[]): Promise<OrchidDocument[]>;
}
