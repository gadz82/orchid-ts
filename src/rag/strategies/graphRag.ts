import { createHash } from "node:crypto";
import { OrchidRetrievalStrategy } from "../../core/retrieval.js";
import type {
    OrchidVectorReader,
    OrchidSearchResult,
    OrchidMetadataFilters,
} from "../../core/repository.js";
import type { OrchidRAGScope } from "../../core/scopes.js";
import type { OrchidGraphStore, OrchidEntity, OrchidEdge } from "../../core/graphStore.js";
import { SimpleRetrieval } from "./simple.js";

type EntitySerializer = (entities: OrchidEntity[], edges: OrchidEdge[]) => string;

function formatProperties(props: Record<string, unknown> | undefined): string {
    if (!props) return "";
    const parts = Object.entries(props)
        .filter(([, v]) => v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}: ${v}`);
    return parts.length ? `  [${parts.join("; ")}]` : "";
}

function defaultSerialise(entities: OrchidEntity[], edges: OrchidEdge[]): string {
    if (!entities.length && !edges.length) {
        return "[Knowledge graph context — empty]";
    }
    const byId = new Map(entities.map((e) => [e.id, e]));
    const lines: string[] = ["[Knowledge graph context]"];
    if (entities.length) {
        lines.push("Entities:");
        for (const entity of [...entities].sort((a, b) => a.id.localeCompare(b.id))) {
            const display = entity.name || entity.id;
            const props = formatProperties(entity.properties);
            lines.push(`  - ${display} (${entity.type || "unknown"}) — id=${entity.id}${props}`);
        }
    }
    if (edges.length) {
        lines.push("Relations:");
        for (const edge of [...edges].sort((a, b) => {
            const aKey = `${a.sourceId}|${a.relation}|${a.targetId}`;
            const bKey = `${b.sourceId}|${b.relation}|${b.targetId}`;
            return aKey.localeCompare(bKey);
        })) {
            const src = byId.get(edge.sourceId);
            const tgt = byId.get(edge.targetId);
            const srcLabel = src?.name || edge.sourceId;
            const tgtLabel = tgt?.name || edge.targetId;
            lines.push(`  - ${srcLabel} -[${edge.relation}]-> ${tgtLabel}`);
        }
    }
    return lines.join("\n");
}

export class GraphRAGRetrieval extends OrchidRetrievalStrategy {
    private maxHops: number;
    private fuseWithVectors: boolean;
    private seedK: number;
    private serialiser: EntitySerializer;

    constructor(
        opts: {
            maxHops?: number;
            fuseWithVectors?: boolean;
            seedK?: number;
            entitySerializer?: EntitySerializer;
        } = {},
    ) {
        super();
        this.maxHops = opts.maxHops ?? 2;
        this.fuseWithVectors = opts.fuseWithVectors ?? true;
        this.seedK = opts.seedK ?? 10;
        this.serialiser = opts.entitySerializer ?? defaultSerialise;
        if (this.maxHops < 0) throw new Error(`maxHops must be >= 0; got ${this.maxHops}`);
        if (this.seedK < 1) throw new Error(`seedK must be >= 1; got ${this.seedK}`);
    }

    override get name(): string {
        return "graph_rag";
    }

    static fromConfig(config: unknown): GraphRAGRetrieval {
        const graph = (config as any)?.graph ?? {};
        return new GraphRAGRetrieval({
            maxHops: graph.max_hops ?? 2,
            fuseWithVectors: graph.fuse_with_vectors ?? true,
        });
    }

    override async retrieve(
        query: string,
        scope: OrchidRAGScope,
        reader: OrchidVectorReader,
        namespace: string,
        k?: number,
        options?: Record<string, unknown>,
    ): Promise<OrchidSearchResult[]> {
        const graphStore = options?.["graphStore"] as OrchidGraphStore | undefined;
        const metadataFilters = (options?.["metadata_filters"] ??
            null) as OrchidMetadataFilters | null;
        const resolvedK = k ?? 5;

        if (!graphStore || (graphStore as any).isNull) {
            console.warn(
                "[GraphRAGRetrieval] no graphStore wired — falling back to SimpleRetrieval",
            );
            return new SimpleRetrieval().retrieve(query, scope, reader, namespace, resolvedK, {
                metadata_filters: metadataFilters,
            });
        }

        const seedEntities = await graphStore.findEntities(query, scope, undefined, this.seedK);
        if (!seedEntities.length) {
            console.error(
                "[GraphRAGRetrieval] no seed entities resolved for %s — vector-only",
                query,
            );
            return new SimpleRetrieval().retrieve(query, scope, reader, namespace, resolvedK, {
                metadata_filters: metadataFilters,
            });
        }

        const seedIds = seedEntities.map((e) => e.id);
        let allEntities: OrchidEntity[] = [];
        let allEdges: OrchidEdge[] = [];
        let currentLayer = [...seedIds];

        for (let hop = 0; hop < this.maxHops && currentLayer.length > 0; hop++) {
            const nextLayer: string[] = [];
            for (const eid of currentLayer) {
                const result = await graphStore.neighbours([eid], scope, 1);
                for (const entity of result.entities) {
                    if (!allEntities.find((e) => e.id === entity.id)) {
                        allEntities.push(entity);
                    }
                }
                for (const edge of result.edges) {
                    const dup = allEdges.find(
                        (e) =>
                            e.sourceId === edge.sourceId &&
                            e.targetId === edge.targetId &&
                            e.relation === edge.relation,
                    );
                    if (!dup) {
                        allEdges.push(edge);
                    }
                    const otherId = edge.sourceId === eid ? edge.targetId : edge.sourceId;
                    if (
                        !allEntities.find((e) => e.id === otherId) &&
                        !nextLayer.includes(otherId)
                    ) {
                        nextLayer.push(otherId);
                    }
                }
            }
            currentLayer = nextLayer;
        }

        let chunkResults: OrchidSearchResult[] = [];
        if (this.fuseWithVectors) {
            chunkResults = await reader.retrieve(
                query,
                namespace,
                Math.max(resolvedK * 2, resolvedK + 1),
                scope,
                metadataFilters,
            );
        }

        const graphText = this.serialiser(allEntities, allEdges);
        const graphDocId = `graph::${createHash("sha256").update(graphText).digest("hex").slice(0, 16)}`;
        const graphResult: OrchidSearchResult = {
            document: {
                id: graphDocId,
                pageContent: graphText,
                metadata: {
                    source: "graph_rag",
                    scope: "chat_shared",
                    tenantId: scope.tenantId,
                    userId: scope.userId,
                    chatId: scope.chatId,
                    agentId: scope.agentId,
                    entity_count: allEntities.length,
                    edge_count: allEdges.length,
                },
            },
            score: 1.0,
        };

        if (!this.fuseWithVectors) return [graphResult];

        const merged: OrchidSearchResult[] = [graphResult];
        for (const hit of chunkResults) {
            if (hit.document.id === graphDocId) continue;
            merged.push(hit);
            if (merged.length >= resolvedK) break;
        }
        return merged.slice(0, resolvedK);
    }
}
