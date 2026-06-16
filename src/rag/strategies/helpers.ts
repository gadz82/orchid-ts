import type {
    OrchidSearchResult,
    OrchidVectorReader,
    OrchidMetadataFilters,
} from "../../core/repository.js";
import type { OrchidRAGScope } from "../../core/scopes.js";
import type { OrchidQueryTransformer } from "../../core/retrieval.js";

export async function expandQueries(
    query: string,
    transformers: OrchidQueryTransformer[],
    chatModel: unknown,
): Promise<string[]> {
    const expanded: string[] = [];
    for (const transformer of transformers) {
        if ((transformer as any).preStrategy) continue;
        try {
            const newQueries = await transformer.transform(query, chatModel);
            expanded.push(...newQueries);
        } catch (err) {
            console.warn("[expandQueries] %s failed: %s", transformer.constructor.name, err);
        }
    }
    return expanded;
}

export async function fanOutRetrieve(opts: {
    queries: string[];
    namespace: string;
    scope: OrchidRAGScope;
    k: number;
    reader: OrchidVectorReader;
    timeoutMs?: number;
    metadataFilters?: OrchidMetadataFilters | null;
}): Promise<OrchidSearchResult[]> {
    const { queries, namespace, scope, k, reader, timeoutMs = 30000, metadataFilters } = opts;
    if (!queries.length) return [];

    const tasks = queries.map((q) =>
        reader.retrieve(q, namespace, k, scope, metadataFilters ?? null).catch((err) => {
            console.warn("[fanOutRetrieve] One query failed: %s", err);
            return [] as OrchidSearchResult[];
        }),
    );

    let allResults: OrchidSearchResult[][];
    try {
        const timeoutPromise = new Promise<OrchidSearchResult[][]>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeoutMs),
        );
        allResults = await Promise.race([Promise.all(tasks), timeoutPromise]);
    } catch (_err) {
        console.warn(
            "[fanOutRetrieve] Timed out after %dms with %d queries — single-query fallback",
            timeoutMs,
            queries.length,
        );
        try {
            allResults = [
                await reader.retrieve(queries[0], namespace, k, scope, metadataFilters ?? null),
            ];
        } catch (fallbackErr) {
            console.warn("[fanOutRetrieve] Fallback retrieve failed: %s", fallbackErr);
            return [];
        }
    }

    const seen = new Map<string, OrchidSearchResult>();
    for (const rs of allResults) {
        for (const sr of rs) {
            const docId = sr.document.id ?? sr.document.pageContent.slice(0, 100);
            const existing = seen.get(docId);
            if (!existing || sr.score > existing.score) {
                seen.set(docId, sr);
            }
        }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

export function mergeAndDeduplicate(
    results: OrchidSearchResult[],
    k: number,
): OrchidSearchResult[] {
    const seen = new Map<string, OrchidSearchResult>();
    for (const sr of results) {
        const docId = sr.document.id ?? sr.document.pageContent.slice(0, 100);
        const existing = seen.get(docId);
        if (!existing || sr.score > existing.score) {
            seen.set(docId, sr);
        }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

export function sortByScore(results: OrchidSearchResult[]): OrchidSearchResult[] {
    return [...results].sort((a, b) => b.score - a.score);
}
