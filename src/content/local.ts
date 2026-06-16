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

    async list(
        dirPath?: string,
        recursive = false,
        limit = 200,
    ): Promise<Array<Record<string, unknown>>> {
        const target = this._resolveSafe(dirPath ?? ".");
        const results: Array<Record<string, unknown>> = [];

        await this._walk(target, results, recursive, limit);

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
            // Fallback to raw text
            text = buffer.toString("utf-8");
        }

        return {
            path: filePath,
            filename,
            content: text,
            size: fileStat.size,
            modified: fileStat.mtimeMs,
            ...this._metadata,
        };
    }

    async search(
        query: string,
        recursive = false,
        limit = 200,
    ): Promise<Array<Record<string, unknown>>> {
        const all = await this.list(undefined, recursive, limit * 2);
        const lower = query.toLowerCase();
        const matched: Array<Record<string, unknown>> = [];

        for (const entry of all) {
            const name = ((entry.filename as string) ?? "").toLowerCase();
            if (name.includes(lower)) {
                matched.push(entry);
                if (matched.length >= limit) break;
            }
        }

        return matched;
    }

    // ── internals ─────────────────────────────────────────────────────

    private _resolveSafe(relativePath: string): string {
        const resolved = resolve(this._root, relativePath);
        // Guard against path traversal: ensure the resolved path stays
        // inside the configured root directory.
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
                    filename: entryName,
                    size: entryStat.size,
                    modified: entryStat.mtimeMs,
                    isDirectory: false,
                    ...this._metadata,
                });
            }
        }
    }
}
