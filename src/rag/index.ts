export type { OrchidRAGScope } from "./scopes.js";
export {
    SHARED_TENANT,
    makeScope,
    scopeFromAuth,
    scopeToFilter,
    promoteScope,
    OrchidRAGLevel,
} from "./scopes.js";

export {
    KNOWN_DIMS,
    getEmbeddingDimension,
    getEmbeddingBatchSize,
    buildEmbeddings,
    BatchLimitingEmbeddings,
} from "./embeddings.js";
export type { EmbeddingsLike } from "./embeddings.js";

export { StaticIndexer } from "./indexer.js";

export {
    VECTOR_BACKEND_REGISTRY,
    DOC_STORE_BACKEND_REGISTRY,
    GRAPH_STORE_BACKEND_REGISTRY,
    registerVectorBackend,
    registerDocStoreBackend,
    registerGraphStoreBackend,
    registerSparseEncoderBackend,
    buildReader,
    buildDocStore,
    buildGraphStore,
    buildSparseEncoder,
} from "./factory.js";
export type {
    VectorBackendBuilder,
    DocStoreBackendBuilder,
    GraphStoreBackendBuilder,
} from "./factory.js";

export { OrchidRetriever } from "./retriever.js";

export {
    toLangchainDocument,
    fromLangchainDocument,
    toLangchainDocuments,
    fromLangchainDocuments,
} from "./adapters.js";

export { injectToRag } from "./dynamic.js";

export { NullVectorReader, NullDocStore, NullGraphStore } from "./backends/null.js";
export { InMemoryDocStore } from "./backends/inMemoryDocStore.js";
export { InMemoryGraphStore } from "./backends/inMemoryGraph.js";

export {
    RETRIEVAL_REGISTRY,
    registerRetrievalStrategy,
    clearStrategies,
    getRetrievalStrategy,
    SimpleRetrieval,
    MultiQueryRetrieval,
    HyDERetrieval,
    HybridRetrieval,
    GraphRAGRetrieval,
} from "./strategies/index.js";
export {
    mergeAndDeduplicate,
    sortByScore,
    fanOutRetrieve,
    expandQueries,
} from "./strategies/helpers.js";

export {
    TRANSFORMER_REGISTRY,
    registerQueryTransformer,
    clearQueryTransformers,
    getQueryTransformer,
    resolveTransformerKwargs,
    ReformulateTransformer,
    MultiQueryTransformer,
    HyDETransformer,
    DecomposeTransformer,
} from "./transformers/index.js";

export {
    SPARSE_ENCODER_REGISTRY,
    registerSparseEncoder,
    getSparseEncoder,
    clearSparseEncoders,
    BM25SparseEncoder,
} from "./sparse/index.js";
