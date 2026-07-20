export interface ContentSourceRuntime {
    list(opts: {
        path: string;
        recursive: boolean;
        limit: number;
    }): Promise<Array<Record<string, unknown>>>;
    search(opts: {
        query: string;
        recursive: boolean;
        limit: number;
    }): Promise<Array<Record<string, unknown>>>;
    get(path: string): Promise<Record<string, unknown>>;
}

function serialiseItem(item: Record<string, unknown>): Record<string, unknown> {
    return {
        path: (item["path"] as string) ?? "",
        name: (item["name"] as string) ?? (item["filename"] as string) ?? "",
        content_type: (item["content_type"] as string) ?? (item["contentType"] as string) ?? "",
        metadata: (item["metadata"] as Record<string, unknown>) ?? {},
        content: item["content"] ?? null,
    };
}

export async function listContentFiles(opts: {
    path?: string;
    recursive?: boolean;
    limit?: number | string;
    contentSources?: ContentSourceRuntime[] | null;
}): Promise<Array<Record<string, unknown>>> {
    const { path = "", recursive = false, limit = 100, contentSources = null } = opts;

    console.info("[listContentFiles] called with path='%s' contentSources=%s", 
        path, contentSources ? contentSources.length : 0);

    if (!contentSources || contentSources.length === 0) {
        console.warn("[listContentFiles] no content sources available");
        return [];
    }

    const _limit = typeof limit === "string" ? parseInt(limit, 10) : limit;
    const results: Array<Record<string, unknown>> = [];

    for (const source of contentSources) {
        try {
            const items = await source.list({ path, recursive, limit: _limit });
            for (const item of items) {
                results.push(serialiseItem(item));
            }
            if (results.length >= _limit) {
                return results.slice(0, _limit);
            }
        } catch {
            continue;
        }
    }

    return results;
}

export async function searchContentFiles(opts: {
    query: string;
    recursive?: boolean;
    limit?: number | string;
    contentSources?: ContentSourceRuntime[] | null;
}): Promise<Array<Record<string, unknown>>> {
    const { query, recursive = true, limit = 10, contentSources = null } = opts;

    if (!contentSources || contentSources.length === 0) {
        return [];
    }

    const _limit = typeof limit === "string" ? parseInt(limit, 10) : limit;
    const results: Array<Record<string, unknown>> = [];

    for (const source of contentSources) {
        try {
            const items = await source.search({ query, recursive, limit: _limit });
            for (const item of items) {
                results.push(serialiseItem(item));
            }
            if (results.length >= _limit) {
                return results.slice(0, _limit);
            }
        } catch {
            continue;
        }
    }

    return results;
}

export async function readContentFile(opts: {
    path: string;
    source?: string;
    contentSources?: ContentSourceRuntime[] | null;
}): Promise<Record<string, unknown>> {
    const { path, source: _source = "", contentSources = null } = opts;

    if (!contentSources || contentSources.length === 0) {
        return { error: "no content sources configured" };
    }

    for (const cs of contentSources) {
        try {
            const item = await cs.get(path);
            return serialiseItem(item);
        } catch (err: unknown) {
            const code = (err as Record<string, unknown>)?.code;
            if (code === "ENOENT" || code === "EISDIR") {
                continue;
            }
            continue;
        }
    }

    return { error: `file not found in any content source: ${path}` };
}
