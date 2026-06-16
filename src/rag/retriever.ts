import type { OrchidVectorReader, OrchidSearchResult } from "../core/repository.js";
import type { OrchidRAGScope } from "../core/scopes.js";
import { toLangchainDocument } from "./adapters.js";

export class OrchidRetriever {
    reader: OrchidVectorReader;
    namespace: string;
    scope: OrchidRAGScope;
    k: number;

    constructor(opts: {
        reader: OrchidVectorReader;
        namespace: string;
        scope: OrchidRAGScope;
        k?: number;
    }) {
        this.reader = opts.reader;
        this.namespace = opts.namespace;
        this.scope = opts.scope;
        this.k = opts.k ?? 5;
    }

    static fromReader(opts: {
        reader: OrchidVectorReader;
        namespace: string;
        scope: OrchidRAGScope;
        k?: number;
    }): OrchidRetriever {
        return new OrchidRetriever(opts);
    }

    async getRelevantDocuments(
        query: string,
    ): Promise<{ id?: string; pageContent: string; metadata: Record<string, unknown> }[]> {
        const results: OrchidSearchResult[] = await this.reader.retrieve(
            query,
            this.namespace,
            this.k,
            this.scope,
        );
        return results.map((r) => toLangchainDocument(r.document));
    }
}
