/** Document ingestion pipeline — parse → strategy → upsert. */

import { createHash } from "node:crypto";
import type { OrchidRAGScope } from "../core/scopes.js";
import type { OrchidVectorWriter, OrchidDocument } from "../core/repository.js";
import type { OrchidDocStore } from "../core/docStore.js";
import { OrchidIngestionStrategy } from "../core/ingestion.js";
import type { OrchidChunkPostProcessor, OrchidChunk } from "../core/ingestion.js";
import { getParser } from "./parsers.js";
import { RecursiveIngestion } from "./strategies/recursive.js";

export async function extractText(opts: {
    fileBytes: Buffer;
    filename: string;
    visionModel?: string;
}): Promise<string> {
    const parser = getParser(opts.filename, { visionModel: opts.visionModel });
    return parser.parse(opts.fileBytes, opts.filename);
}

export async function ingestDocument(opts: {
    fileBytes?: Buffer;
    filename: string;
    scope: OrchidRAGScope;
    namespace?: string;
    writer: OrchidVectorWriter;
    ingestion?: OrchidIngestionStrategy | null;
    postProcessors?: OrchidChunkPostProcessor[] | null;
    docStore?: OrchidDocStore | null;
    graphStore?: unknown;
    embeddings?: unknown;
    chatModel?: unknown;
    schema?: Record<string, unknown>;
    visionModel?: string;
    preExtractedText?: string | null;
}): Promise<number> {
    const {
        fileBytes,
        filename,
        scope,
        namespace = "uploads",
        writer,
        ingestion,
        postProcessors,
        docStore,
        graphStore,
        embeddings,
        chatModel,
        schema,
        visionModel,
        preExtractedText,
    } = opts;

    // 1. Obtain text — reuse if already extracted
    let text: string;
    if (preExtractedText != null) {
        text = preExtractedText;
    } else {
        if (!fileBytes) {
            throw new Error("Either fileBytes or preExtractedText must be provided");
        }
        text = await extractText({ fileBytes, filename, visionModel });
    }

    if (!text.trim()) {
        return 0;
    }

    // 2. Run the configured ingestion strategy
    const strategy = ingestion ?? new RecursiveIngestion();
    let chunks: OrchidChunk[] = await strategy.ingest({
        text,
        filename,
        scope,
        docStore,
        embeddings,
    });

    if (!chunks || chunks.length === 0) {
        return 0;
    }

    // 3. Run post-processors in order
    for (const proc of postProcessors ?? []) {
        chunks = await proc.process(chunks, {
            text,
            filename,
            chatModel,
            graphStore,
            scope,
            schema,
        });
    }

    // 4. Convert to OrchidDocument and upsert
    const fileHash = createHash("sha256").update(text).digest("hex").slice(0, 12);
    const documents: OrchidDocument[] = chunks.map((c, i) => {
        const id = (c.metadata.chunk_id as string) || `${filename}-${fileHash}-${i}`;
        return {
            id,
            pageContent: c.text,
            metadata: c.metadata,
        };
    });

    await writer.upsert(documents, namespace);

    return documents.length;
}
