/**
 * Local-filesystem content source.
 *
 * Implements OrchidContentSource using `node:fs` / `node:path` so
 * agents can browse and retrieve files from an on-disk directory.
 * Guards against path-traversal attacks by resolving all paths
 * against the configured root.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, relative, extname, basename } from "node:path";
import type { OrchidContentSource } from "../core/content.js";
import { extractText } from "../documents/pipeline.js";

export interface LocalFileContentSourceOptions {
    /** Absolute or relative path to the root content directory. */
    path: string;
    /** File extensions to include.  Defaults to all files. */
    fileExtensions?: string[];
    /** Optional static metadata merged into every returned document. */
    metadata?: Record<string, unknown>;
}

export class LocalFileContentSource implements OrchidContentSource {
    type = "local";
    uri: string;
    description = "Local filesystem content source";

    private _root: string;
    private _extensions: Set<string> | null;
    private _metadata: Record<string, unknown>;

    constructor(opts: LocalFileContentSourceOptions) {
        this._root = resolve(opts.path);
        this.uri = `file://${this._root}`;
        this._extensions = opts.fileExtensions
            ? new Set(opts.fileExtensions.map((e) => e.toLowerCase()))
            : null;
        this._metadata = opts.metadata ?? {};
    }

    async list(opts?: {
        path?: string;
        recursive?: boolean;
        limit?: number;
    }): Promise<Array<Record<string, unknown>>> {
        const dirPath = opts?.path ?? "";
        const recursive = opts?.recursive ?? false;
        const limit = opts?.limit ?? 200;
        const target = this._resolveSafe(dirPath || ".");
        console.info("[LocalFileContentSource] list() called with path='%s' target='%s' root='%s'", 
            dirPath, target, this._root);
        const results: Array<Record<string, unknown>> = [];

        await this._walk(target, results, recursive, limit);
        console.info("[LocalFileContentSource] list() found %d files", results.length);

        return results;
    }

    async get(filePath: string): Promise<Record<string, unknown>> {
        const full = this._resolveSafe(filePath);
        const fileStat = await stat(full);
        if (!fileStat.isFile()) {
            throw new Error(`Not a file: ${filePath}`);
        }

        const buffer = await readFile(full);
        const filename = basename(full);

        let text = "";
        try {
            text = await extractText({
                fileBytes: buffer,
                filename,
            });
        } catch {
            text = buffer.toString("utf-8");
        }

        return {
            path: filePath,
            name: filename,
            filename,
            content: text,
            content_type: "text/plain",
            size: fileStat.size,
            modified: fileStat.mtimeMs,
            metadata: { ...this._metadata },
            ...this._metadata,
        };
    }

    async search(opts: {
        query: string;
        recursive?: boolean;
        limit?: number;
    }): Promise<Array<Record<string, unknown>>> {
        const query = opts.query;
        const recursive = opts.recursive ?? false;
        const limit = opts.limit ?? 200;
        const all = await this.list({ path: "", recursive, limit: limit * 2 });
        const lower = query.toLowerCase();
        const matched: Array<Record<string, unknown>> = [];

        for (const entry of all) {
            const name = ((entry.filename as string) ?? (entry.name as string) ?? "").toLowerCase();
            if (name.includes(lower)) {
                matched.push(entry);
                if (matched.length >= limit) break;
            }
        }

        return matched;
    }

    private _resolveSafe(relativePath: string): string {
        const resolved = resolve(this._root, relativePath);
        if (!resolved.startsWith(this._root + "/") && resolved !== this._root) {
            throw new Error(`Path traversal detected: ${relativePath}`);
        }
        return resolved;
    }

    private async _walk(
        dir: string,
        results: Array<Record<string, unknown>>,
        recursive: boolean,
        limit: number,
    ): Promise<void> {
        if (results.length >= limit) return;

        let entries: string[];
        try {
            entries = await readdir(dir);
        } catch {
            return;
        }

        for (const entryName of entries) {
            if (results.length >= limit) break;

            const full = join(dir, entryName);
            let entryStat: Awaited<ReturnType<typeof stat>>;
            try {
                entryStat = await stat(full);
            } catch {
                continue;
            }

            const rel = relative(this._root, full);

            if (entryStat.isDirectory()) {
                if (recursive) {
                    await this._walk(full, results, recursive, limit);
                }
            } else if (entryStat.isFile()) {
                if (this._extensions) {
                    const ext = extname(entryName).toLowerCase();
                    if (!this._extensions.has(ext)) continue;
                }
                results.push({
                    path: rel,
                    name: entryName,
                    filename: entryName,
                    content_type: "text/plain",
                    size: entryStat.size,
                    modified: entryStat.mtimeMs,
                    isDirectory: false,
                    metadata: { ...this._metadata },
                    ...this._metadata,
                });
            }
        }
    }
}
