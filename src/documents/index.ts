/** documents/ barrel — public surface for document parsing, chunking, and ingestion. */

// Parsers
export {
    DocumentParser,
    PDFParser,
    DOCXParser,
    XLSXParser,
    CSVParser,
    TextParser,
    ImageParser,
    PARSER_REGISTRY,
    registerParser,
    getParser,
} from "./parsers.js";

// Chunker
export type { ChunkConfig, ParentChildChunk } from "./chunker.js";
export { chunkText, parentChildChunkText } from "./chunker.js";

// Pipeline
export { extractText, ingestDocument } from "./pipeline.js";

// Strategies
export {
    INGESTION_REGISTRY,
    POST_PROCESSOR_REGISTRY,
    registerIngestionStrategy,
    getIngestionStrategy,
    buildIngestionStrategy,
    registerPostProcessor,
    getPostProcessor,
} from "./strategies/index.js";
export { RecursiveIngestion } from "./strategies/recursive.js";
export { SemanticIngestion } from "./strategies/semantic.js";
export { HierarchicalIngestion } from "./strategies/hierarchical.js";
export { HeaderedIngestion } from "./strategies/headered.js";

// Post-processors
export { ContextualHeaderPostProcessor } from "./postProcessors/contextualHeaders.js";
export {
    LLMEntityExtractor,
    EntityExtractionPostProcessor,
} from "./postProcessors/entityExtraction.js";
