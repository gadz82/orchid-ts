import { OrchidGraphStore } from "../../core/graphStore.js";
import type { OrchidEntity, OrchidEdge } from "../../core/graphStore.js";
import type { OrchidRAGScope } from "../../core/scopes.js";

function edgeKey(e: OrchidEdge): string {
    return `${e.sourceId}|${e.targetId}|${e.relation}`;
}

export class InMemoryGraphStore extends OrchidGraphStore {
    private entities = new Map<string, OrchidEntity>();
    private outEdges = new Map<string, OrchidEdge[]>();
    private inEdges = new Map<string, OrchidEdge[]>();

    override async upsertEntities(entities: OrchidEntity[], _scope: OrchidRAGScope): Promise<void> {
        for (const entity of entities) {
            this.entities.set(entity.id, entity);
        }
    }

    override async upsertEdges(edges: OrchidEdge[], _scope: OrchidRAGScope): Promise<void> {
        for (const edge of edges) {
            const existing = this.outEdges.get(edge.sourceId) ?? [];
            const dup = existing.find(
                (e) =>
                    e.sourceId === edge.sourceId &&
                    e.targetId === edge.targetId &&
                    e.relation === edge.relation,
            );
            if (!dup) {
                existing.push(edge);
                this.outEdges.set(edge.sourceId, existing);
                const inList = this.inEdges.get(edge.targetId) ?? [];
                inList.push(edge);
                this.inEdges.set(edge.targetId, inList);
            }
        }
    }

    override async findEntities(
        query: string,
        _scope: OrchidRAGScope,
        typeFilter?: string[] | null,
        k?: number,
    ): Promise<OrchidEntity[]> {
        const limit = k ?? 10;
        if (!this.entities.size) return [];
        const q = query.toLowerCase().trim();
        if (!q) return [];
        const typeSet = typeFilter ? new Set(typeFilter) : null;
        const results: Array<{ score: number; entity: OrchidEntity }> = [];
        for (const entity of this.entities.values()) {
            if (typeSet && !typeSet.has(entity.type)) continue;
            const score = this.matchScore(q, entity);
            if (score > 0) {
                results.push({ score, entity });
            }
        }
        results.sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));
        return results.slice(0, limit).map((r) => r.entity);
    }

    override async neighbours(
        entityIds: string[],
        _scope: OrchidRAGScope,
        maxHops = 2,
        _relationFilter?: string[] | null,
    ): Promise<{ entities: OrchidEntity[]; edges: OrchidEdge[] }> {
        if (!this.entities.size || maxHops < 0) return { entities: [], edges: [] };
        const visitedEntities = new Map<string, OrchidEntity>();
        const visitedEdges: OrchidEdge[] = [];
        const visitedEdgeKeys = new Set<string>();
        let currentLayer = new Set<string>();
        for (const eid of entityIds) {
            const entity = this.entities.get(eid);
            if (entity) {
                visitedEntities.set(eid, entity);
                currentLayer.add(eid);
            }
        }
        for (let hop = 0; hop < maxHops; hop++) {
            const nextLayer = new Set<string>();
            for (const eid of currentLayer) {
                const outgoing = this.outEdges.get(eid) ?? [];
                const incoming = this.inEdges.get(eid) ?? [];
                for (const edge of [...outgoing, ...incoming]) {
                    const key = edgeKey(edge);
                    if (visitedEdgeKeys.has(key)) continue;
                    visitedEdgeKeys.add(key);
                    visitedEdges.push(edge);
                    const otherId = edge.sourceId === eid ? edge.targetId : edge.sourceId;
                    if (!visitedEntities.has(otherId) && this.entities.has(otherId)) {
                        visitedEntities.set(otherId, this.entities.get(otherId)!);
                        nextLayer.add(otherId);
                    }
                }
            }
            if (!nextLayer.size) break;
            currentLayer = nextLayer;
        }
        return { entities: [...visitedEntities.values()], edges: visitedEdges };
    }

    override async close(): Promise<void> {
        this.entities.clear();
        this.outEdges.clear();
        this.inEdges.clear();
    }

    private matchScore(q: string, entity: OrchidEntity): number {
        const nameLower = (entity.name || "").toLowerCase();
        const idLower = entity.id.toLowerCase();
        if (nameLower && nameLower === q) return 1.0;
        if (idLower === q) return 0.95;
        if (nameLower && nameLower.includes(q)) return 0.6;
        if (idLower.includes(q)) return 0.4;
        for (const val of Object.values(entity.properties || {})) {
            if (typeof val === "string" && val.toLowerCase().includes(q)) return 0.3;
        }
        return 0;
    }
}
