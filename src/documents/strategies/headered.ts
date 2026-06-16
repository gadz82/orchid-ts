/** HeaderedIngestion — recursive chunking + contextual headers. */

import type { OrchidRAGScope } from "../../core/scopes.js";
import { OrchidIngestionStrategy } from "../../core/ingestion.js";
import type { OrchidChunk } from "../../core/ingestion.js";
import type { ChunkConfig } from "../chunker.js";
import { RecursiveIngestion } from "./recursive.js";
import { ContextualHeaderPostProcessor } from "../postProcessors/contextualHeaders.js";

export class HeaderedIngestion extends OrchidIngestionStrategy {
    private _inner: RecursiveIngestion;
    private _post: ContextualHeaderPostProcessor;

    constructor(config?: ChunkConfig) {
        super();
        this._inner = new RecursiveIngestion(config);
        this._post = new ContextualHeaderPostProcessor();
    }

    async ingest(opts: {
        text: string;
        filename: string;
        scope: OrchidRAGScope;
        docStore?: unknown;
        embeddings?: unknown;
    }): Promise<OrchidChunk[]> {
        const chunks = await this._inner.ingest(opts);
        return this._post.process(chunks, {
            text: opts.text,
            filename: opts.filename,
        });
    }
}
