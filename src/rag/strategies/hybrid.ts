import { OrchidRetrievalStrategy } from "../../core/retrieval.js";
import type {
    OrchidVectorReader,
    OrchidSearchResult,
    OrchidMetadataFilters,
} from "../../core/repository.js";
import type { OrchidRAGScope } from "../../core/scopes.js";
import type { OrchidSparseEncoder } from "../../core/sparse.js";
import { BM25SparseEncoder } from "../sparse/bm25.js";

type FusionAlgo = "rrf" | "linear";

function docId(sr: OrchidSearchResult): string {
    return sr.document.id ?? sr.document.pageContent.slice(0, 100);
}

function rrfMerge(
    dense: OrchidSearchResult[],
    sparse: OrchidSearchResult[],
    topK: number,
    rrfK: number,
): OrchidSearchResult[] {
    const scores = new Map<string, number>();
    const docs = new Map<string, OrchidSearchResult>();
    for (const ranking of [dense, sparse]) {
        for (let rank = 0; rank < ranking.length; rank++) {
            const sr = ranking[rank];
            const id = docId(sr);
            scores.set(id, (scores.get(id) ?? 0) + 1.0 / (rrfK + rank + 1));
            if (!docs.has(id)) docs.set(id, sr);
        }
    }
    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const out: OrchidSearchResult[] = [];
    for (const [id, sc] of sorted.slice(0, topK)) {
        out.push({ document: docs.get(id)!.document, score: sc });
    }
    return out;
}

function minmaxNormalise(results: OrchidSearchResult[]): Array<[OrchidSearchResult, number]> {
    if (!results.length) return [];
    const scores = results.map((r) => r.score);
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    const rng = hi - lo;
    if (rng <= 0) return results.map((sr) => [sr, 1.0] as [OrchidSearchResult, number]);
    return results.map((sr) => [sr, (sr.score - lo) / rng] as [OrchidSearchResult, number]);
}

function linearMerge(
    dense: OrchidSearchResult[],
    sparse: OrchidSearchResult[],
    topK: number,
    sparseWeight: number,
): OrchidSearchResult[] {
    const denseNorm = minmaxNormalise(dense);
    const sparseNorm = minmaxNormalise(sparse);
    const denseWeight = 1.0 - sparseWeight;

    const scores = new Map<string, number>();
    const docs = new Map<string, OrchidSearchResult>();
    for (const [sr, sc] of denseNorm) {
        const id = docId(sr);
        scores.set(id, (scores.get(id) ?? 0) + denseWeight * sc);
        if (!docs.has(id)) docs.set(id, sr);
    }
    for (const [sr, sc] of sparseNorm) {
        const id = docId(sr);
        scores.set(id, (scores.get(id) ?? 0) + sparseWeight * sc);
        if (!docs.has(id)) docs.set(id, sr);
    }
    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, topK).map(([id, sc]) => ({
        document: docs.get(id)!.document,
        score: sc,
    }));
}

export class HybridRetrieval extends OrchidRetrievalStrategy {
    private sparseEncoder: OrchidSparseEncoder;
    private sparseWeight: number;
    private fusion: FusionAlgo;
    private rrfK: number;
    private laneMultiplier: number;

    constructor(
        opts: {
            sparseEncoder?: OrchidSparseEncoder;
            sparseWeight?: number;
            fusion?: FusionAlgo;
            rrfK?: number;
            laneMultiplier?: number;
        } = {},
    ) {
        super();
        this.sparseEncoder = opts.sparseEncoder ?? new BM25SparseEncoder();
        this.sparseWeight = opts.sparseWeight ?? 0.4;
        this.fusion = opts.fusion ?? "rrf";
        this.rrfK = opts.rrfK ?? 60;
        this.laneMultiplier = opts.laneMultiplier ?? 3;

        if (this.sparseWeight < 0 || this.sparseWeight > 1) {
            throw new Error(`sparseWeight must be in [0, 1]; got ${this.sparseWeight}`);
        }
        if (this.rrfK <= 0) {
            throw new Error(`rrfK must be > 0; got ${this.rrfK}`);
        }
        if (this.laneMultiplier < 1) {
            throw new Error(`laneMultiplier must be >= 1; got ${this.laneMultiplier}`);
        }
    }

    override get name(): string {
        return "hybrid";
    }

    static fromConfig(config: unknown): HybridRetrieval {
        const hybrid = (config as any)?.hybrid ?? {};
        return new HybridRetrieval({
            sparseEncoder: hybrid.sparse_encoder ? undefined : new BM25SparseEncoder(),
            sparseWeight: hybrid.sparse_weight ?? 0.4,
            fusion: hybrid.fusion ?? "rrf",
            rrfK: hybrid.rrf_k ?? 60,
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
        const metadataFilters = options?.["metadata_filters"] as OrchidMetadataFilters | undefined;
        const resolvedK = k ?? 5;
        const laneK = resolvedK * this.laneMultiplier;

        let sparseQuery = null;
        try {
            sparseQuery = await this.sparseEncoder.encode(query);
        } catch (err) {
            console.warn("[HybridRetrieval] Sparse encoder failed: %s — dense-only", err);
        }

        const [denseRaw, sparseRaw] = await Promise.all([
            reader
                .retrieve(
                    query,
                    namespace,
                    laneK,
                    scope,
                    (metadataFilters ?? null) as OrchidMetadataFilters | null,
                )
                .catch((err) => {
                    console.warn("[HybridRetrieval] Dense retrieval failed: %s", err);
                    return [] as OrchidSearchResult[];
                }),
            sparseQuery
                ? reader
                      .retrieveSparse(
                          sparseQuery,
                          namespace,
                          laneK,
                          scope,
                          (metadataFilters ?? null) as OrchidMetadataFilters | null,
                      )
                      .catch((err: unknown) => {
                          if (err instanceof Error && err.message.includes("not support sparse")) {
                              console.warn(
                                  "[HybridRetrieval] Backend lacks sparse support — dense-only fallback",
                              );
                          } else {
                              console.warn("[HybridRetrieval] Sparse retrieval failed: %s", err);
                          }
                          return [] as OrchidSearchResult[];
                      })
                : Promise.resolve([] as OrchidSearchResult[]),
        ]);

        const dense = denseRaw;
        const sparse = Array.isArray(sparseRaw) ? sparseRaw : [];

        if (!sparse.length) {
            return dense.slice(0, resolvedK);
        }

        if (this.fusion === "rrf") {
            return rrfMerge(dense, sparse, resolvedK, this.rrfK);
        }
        return linearMerge(dense, sparse, resolvedK, this.sparseWeight);
    }
}
