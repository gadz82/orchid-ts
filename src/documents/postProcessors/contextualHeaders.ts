/** ContextualHeaderPostProcessor — prepend # {title}\n## {section}\n to every chunk. */

import { OrchidChunkPostProcessor } from "../../core/ingestion.js";
import type { OrchidChunk } from "../../core/ingestion.js";

const _HEADING_LINE = /^(#{1,6})\s+(.+?)\s*$/gm;

function _filenameToTitle(filename: string): string {
    if (!filename) return "Document";
    const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
    const base = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
    const dotIdx = base.lastIndexOf(".");
    const stem = dotIdx >= 0 ? base.slice(0, dotIdx) : base;
    const cleaned = stem.replace(/[_-]/g, " ").trim();
    if (!cleaned) return "Document";
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function _buildHeadingIndex(text: string): Array<{ pos: number; text: string }> {
    const headings: Array<{ pos: number; text: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = _HEADING_LINE.exec(text)) !== null) {
        headings.push({ pos: match.index, text: match[2].trim() });
    }
    return headings;
}

function _sectionForPosition(headings: Array<{ pos: number; text: string }>, pos: number): string {
    let section = "Document";
    for (const h of headings) {
        if (h.pos <= pos) {
            section = h.text;
        } else {
            break;
        }
    }
    return section;
}

const HEADER_TEMPLATE = "# {title}\n## {section}\n\n";

export class ContextualHeaderPostProcessor extends OrchidChunkPostProcessor {
    async process(
        chunks: OrchidChunk[],
        opts: {
            text: string;
            filename: string;
            chatModel?: unknown;
            graphStore?: unknown;
            scope?: unknown;
            schema?: Record<string, unknown>;
        },
    ): Promise<OrchidChunk[]> {
        if (chunks.length === 0) return [];

        const { text, filename } = opts;
        const title = _filenameToTitle(filename);
        const headings = _buildHeadingIndex(text);

        const out: OrchidChunk[] = [];
        let cursor = 0;
        for (const chunk of chunks) {
            if (chunk.metadata["contextual_header"]) {
                out.push(chunk);
                continue;
            }

            let pos = text.indexOf(chunk.text, cursor);
            if (pos === -1) {
                pos = cursor;
            } else {
                cursor = pos + chunk.text.length;
            }

            const section = _sectionForPosition(headings, pos);
            const prefix = HEADER_TEMPLATE.replace("{title}", title).replace("{section}", section);

            out.push({
                text: prefix + chunk.text,
                metadata: {
                    ...chunk.metadata,
                    section,
                    title,
                    contextual_header: true,
                },
            });
        }
        return out;
    }
}
