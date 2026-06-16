/** Text chunking for document ingestion. */

export interface ChunkConfig {
    chunkSize?: number; // default 1000
    chunkOverlap?: number; // default 200
    separator?: string; // default "\n\n"
    parentChunkSize?: number; // default 0 (disabled)
    parentChunkOverlap?: number; // default 200
}

const DEFAULT_CONFIG: Required<ChunkConfig> = {
    chunkSize: 1000,
    chunkOverlap: 200,
    separator: "\n\n",
    parentChunkSize: 0,
    parentChunkOverlap: 200,
};

function _resolveConfig(config?: ChunkConfig): Required<ChunkConfig> {
    if (!config) return { ...DEFAULT_CONFIG };
    return {
        chunkSize: config.chunkSize ?? DEFAULT_CONFIG.chunkSize,
        chunkOverlap: config.chunkOverlap ?? DEFAULT_CONFIG.chunkOverlap,
        separator: config.separator ?? DEFAULT_CONFIG.separator,
        parentChunkSize: config.parentChunkSize ?? DEFAULT_CONFIG.parentChunkSize,
        parentChunkOverlap: config.parentChunkOverlap ?? DEFAULT_CONFIG.parentChunkOverlap,
    };
}

function _recursiveSplit(
    text: string,
    separators: string[],
    chunkSize: number,
    chunkOverlap: number,
): string[] {
    if (text.length <= chunkSize) {
        return text.trim() ? [text.trim()] : [];
    }

    // Try each separator in order; split on the first one that produces more than one piece
    for (const sep of separators) {
        if (!sep) {
            // Empty separator = character-level split
            return _forceSplit(text, chunkSize, chunkOverlap);
        }
        const parts = text.split(sep);
        if (parts.length > 1) {
            const result: string[] = [];
            let current = "";
            for (const part of parts) {
                const candidate = current ? current + sep + part : part;
                if (candidate.length > chunkSize && current.length > 0) {
                    if (current.length <= chunkSize) {
                        result.push(current.trim());
                    } else {
                        result.push(
                            ..._recursiveSplit(
                                current,
                                separators.slice(1),
                                chunkSize,
                                chunkOverlap,
                            ),
                        );
                    }
                    current = part;
                } else {
                    current = candidate;
                }
            }
            if (current) {
                if (current.length <= chunkSize) {
                    result.push(current.trim());
                } else {
                    result.push(
                        ..._recursiveSplit(current, separators.slice(1), chunkSize, chunkOverlap),
                    );
                }
            }
            // Merge small last chunks into the previous one
            return _mergeShortChunks(result, chunkSize, chunkOverlap, sep);
        }
    }

    // No separator worked — force split by character
    return _forceSplit(text, chunkSize, chunkOverlap);
}

function _mergeShortChunks(
    chunks: string[],
    chunkSize: number,
    _chunkOverlap: number,
    sep: string,
): string[] {
    if (chunks.length <= 1) return chunks;

    const result: string[] = [chunks[0]];
    for (let i = 1; i < chunks.length; i++) {
        const prev = result[result.length - 1];
        const combined = prev + sep + chunks[i];
        if (combined.length <= chunkSize) {
            result[result.length - 1] = combined;
        } else {
            result.push(chunks[i]);
        }
    }
    return result;
}

function _forceSplit(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push(text.slice(start, end).trim());
        start += chunkSize - chunkOverlap;
    }
    return chunks;
}

export interface ParentChildChunk {
    childText: string;
    parentText: string;
    parentIndex: number;
    childIndex: number;
}

export function chunkText(text: string, config?: ChunkConfig): string[] {
    const cfg = _resolveConfig(config);

    if (!text.trim()) return [];
    if (text.length <= cfg.chunkSize) return [text.trim()];

    const separators = [cfg.separator, "\n", " ", ""];
    return _recursiveSplit(text, separators, cfg.chunkSize, cfg.chunkOverlap);
}

export function parentChildChunkText(text: string, config?: ChunkConfig): ParentChildChunk[] {
    const cfg = _resolveConfig(config);

    if (!text.trim()) return [];

    const parentSize = cfg.parentChunkSize || cfg.chunkSize * 4;
    const parentSeparators = [cfg.separator, "\n", " ", ""];
    const childSeparators = [cfg.separator, "\n", " ", ""];

    const parentChunks = _recursiveSplit(
        text,
        parentSeparators,
        parentSize,
        cfg.parentChunkOverlap,
    );
    const result: ParentChildChunk[] = [];

    for (let pi = 0; pi < parentChunks.length; pi++) {
        const parentText = parentChunks[pi];
        const childChunks = _recursiveSplit(
            parentText,
            childSeparators,
            cfg.chunkSize,
            cfg.chunkOverlap,
        );
        const finalChildren = childChunks.length > 0 ? childChunks : [parentText.trim()];

        for (let ci = 0; ci < finalChildren.length; ci++) {
            result.push({
                childText: finalChildren[ci],
                parentText,
                parentIndex: pi,
                childIndex: ci,
            });
        }
    }

    return result;
}
