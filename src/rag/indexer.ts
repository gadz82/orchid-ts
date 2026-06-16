import type { OrchidDocument, OrchidVectorWriter } from "../core/repository.js";
export { SHARED_TENANT } from "../core/scopes.js";

interface NamespaceData {
    sharedDocs: OrchidDocument[];
    tenantDocsFn: ((tenantKey: string) => OrchidDocument[]) | null;
}

export class StaticIndexer {
    private writer: OrchidVectorWriter;
    private namespaces = new Map<string, NamespaceData>();

    constructor(writer: OrchidVectorWriter) {
        this.writer = writer;
    }

    registerNamespace(
        namespace: string,
        sharedDocs: OrchidDocument[],
        tenantDocsFn?: (tenantKey: string) => OrchidDocument[],
    ): void {
        this.namespaces.set(namespace, {
            sharedDocs,
            tenantDocsFn: tenantDocsFn ?? null,
        });
        console.error(
            "[Indexer] Registered namespace '%s' (%d shared docs)",
            namespace,
            sharedDocs.length,
        );
    }

    async indexAll(tenantKey = "default"): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        for (const [namespace, data] of this.namespaces) {
            const docs = [...data.sharedDocs];
            if (data.tenantDocsFn) {
                docs.push(...data.tenantDocsFn(tenantKey));
            }
            await this.writer.index(docs, namespace);
            counts[namespace] = docs.length;
            console.error(
                "[Indexer] Indexed %d docs in '%s' (tenant=%s + shared)",
                docs.length,
                namespace,
                tenantKey,
            );
        }
        return counts;
    }

    async indexSharedOnly(): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        for (const [namespace, data] of this.namespaces) {
            if (data.sharedDocs.length > 0) {
                await this.writer.index(data.sharedDocs, namespace);
                counts[namespace] = data.sharedDocs.length;
            }
        }
        console.error("[Indexer] Indexed shared docs: %j", counts);
        return counts;
    }
}
