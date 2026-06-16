import type { OrchidVectorReader, OrchidVectorWriter } from "../core/index.js";
import type { OrchidRAGScope } from "../core/index.js";

export async function triggerIngestion(opts: {
    namespace: string;
    filePath: string;
    reader: OrchidVectorReader;
    writer: OrchidVectorWriter;
    scope: OrchidRAGScope;
}): Promise<number> {
    const { namespace, filePath, writer, scope: _scope } = opts;

    const content = await readFileContent(filePath);
    const chunks = chunkContent(content, { maxChunkSize: 2000, overlap: 200 });

    const documents = chunks.map((text, index) => ({
        pageContent: text,
        metadata: {
            source: filePath,
            namespace,
            chunkIndex: index,
            totalChunks: chunks.length,
        },
    }));

    await writer.index(documents as any, namespace);
    return chunks.length;
}

async function readFileContent(filePath: string): Promise<string> {
    const fs = await import("node:fs/promises");
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`Failed to fetch content: ${response.status}`);
        }
        return response.text();
    }
    return fs.readFile(filePath, "utf-8");
}

function chunkContent(content: string, opts: { maxChunkSize: number; overlap: number }): string[] {
    const { maxChunkSize, overlap } = opts;
    const chunks: string[] = [];
    let start = 0;

    while (start < content.length) {
        let end = start + maxChunkSize;
        if (end < content.length) {
            const searchEnd = Math.max(start + maxChunkSize - overlap, start + 1);
            const breakChars = ["\n\n", "\n", ". ", " "];
            let found = false;

            for (const sep of breakChars) {
                const lastIdx = content.lastIndexOf(sep, end);
                if (lastIdx > searchEnd) {
                    end = lastIdx + sep.length;
                    found = true;
                    break;
                }
            }
            if (!found) {
                end = searchEnd;
            }
        }

        chunks.push(content.slice(start, Math.min(end, content.length)).trim());
        start = end - overlap;
        if (start < 0) start = 0;
        if (start >= content.length - overlap) break;
    }

    return chunks.filter((c) => c.length > 0);
}
