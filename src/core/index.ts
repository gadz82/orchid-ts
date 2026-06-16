/** Public surface for core/ — pure abstractions and data types. */

// State
export { OrchidAuthContext } from "./state.js";
export type { OrchidAgentState, OrchidAgentStateLike } from "./state.js";

// Agent
export { OrchidAgent, getRunContext, runWithContext } from "./agent.js";
export type { OrchidAgentRunContext } from "./agent.js";

// Content
export type { OrchidContentSource } from "./content.js";

// Repository (vector store)
export {
    OrchidVectorReader,
    OrchidVectorWriter,
    OrchidVectorStoreAdmin,
    OrchidVectorStoreRepository,
} from "./repository.js";
export type {
    OrchidDocument,
    OrchidSearchResult,
    OrchidMetadataFilters,
    OrchidMetadataFilterValue,
    OrchidMetadataRangeFilter,
    OrchidMetadataContainsFilter,
    OrchidMetadataNegationFilter,
} from "./repository.js";

// Scopes
export {
    SHARED_TENANT,
    OrchidRAGLevel,
    makeScope,
    scopeFromAuth,
    scopeToFilter,
    promoteScope,
} from "./scopes.js";
export type { OrchidRAGScope } from "./scopes.js";

// MCP Interfaces
export {
    OrchidMCPToolCaller,
    OrchidMCPDiscoverable,
    OrchidMCPClient,
    OrchidCacheableMCPClient,
} from "./mcpInterfaces.js";

// MCP Result
export { OrchidMCPToolResult } from "./mcpResult.js";
export type { MCPContentBlock } from "./mcpResult.js";

// MCP Errors
export { OrchidMCPAuthRequiredError, OrchidMCPDiscoveryError } from "./mcpErrors.js";

// MCP Tokens
export { OrchidMCPTokenRecord } from "./mcpTokens.js";
export type { OrchidMCPTokenRecord as OrchidMCPTokenRecordType } from "./mcpTokens.js";
export { OrchidTokenSerializer } from "./mcpTokens.js";
export type { OrchidMCPTokenStore } from "./mcpTokens.js";
export { OrchidMCPTokenStore as OrchidMCPTokenStoreABC } from "./mcpTokens.js";

// MCP Registration
export { OrchidMCPClientRegistration } from "./mcpRegistration.js";
export { OrchidMCPClientRegistrationStore as OrchidMCPClientRegistrationStoreABC } from "./mcpRegistration.js";

// MCP Gateway State
export type {
    OrchidMCPGatewayClient,
    OrchidMCPGatewayAuthCode,
    OrchidMCPGatewayToken,
} from "./mcpGatewayState.js";
export {
    OrchidMCPGatewayClientStore as OrchidMCPGatewayClientStoreABC,
    OrchidMCPGatewayAuthCodeStore as OrchidMCPGatewayAuthCodeStoreABC,
    OrchidMCPGatewayTokenStore as OrchidMCPGatewayTokenStoreABC,
} from "./mcpGatewayState.js";

// Identity
export {
    OrchidIdentityResolver,
    OrchidIdentityError,
    MintingProbeUnsupportedError,
} from "./identity.js";
export { OrchidServiceAccountUnknownError } from "./identity.js";

// Auth Config
export type { OrchidUpstreamOAuthConfig } from "./authConfig.js";
export { OrchidAuthConfigProvider, OrchidAuthExchangeClient } from "./authConfig.js";

// Identity Conformance
export { IdentityConformanceError, validateIdentityConformance } from "./identityConformance.js";
export type { ConformanceResult } from "./identityConformance.js";

// Guardrails
export {
    OrchidGuardrailAction,
    OrchidGuardrailDirection,
    OrchidGuardrailResult,
    OrchidGuardrail,
    OrchidGuardrailChain,
} from "./guardrails.js";
export type { OrchidGuardrailContext } from "./guardrails.js";

// Interrupts
export { GraphInterrupt, isGraphInterrupt } from "./graphInterrupt.js";
export type { ToolApprovalPayload } from "./graphInterrupt.js";
export { globalPendingInterrupts } from "./pendingInterrupts.js";

// Run Config
export { CONFIG_KEY_AUTH, authFromConfig, withAuth } from "./runConfig.js";

// Document Store
export { OrchidDocStore } from "./docStore.js";

// Graph Store
export { OrchidGraphStore, OrchidEntityExtractor } from "./graphStore.js";
export type { OrchidEntity, OrchidEdge } from "./graphStore.js";

// Ingestion
export { OrchidIngestionStrategy, OrchidChunkPostProcessor } from "./ingestion.js";
export type { OrchidChunk } from "./ingestion.js";

// Retrieval
export { OrchidRetrievalStrategy, OrchidQueryTransformer } from "./retrieval.js";

// Sparse
export { OrchidSparseEncoder } from "./sparse.js";
export type { OrchidSparseVector } from "./sparse.js";

// Memory
export { OrchidConversationMemory, NullConversationMemory } from "./memory.js";
export type { OrchidConversationSummary, OrchidSummaryEntity } from "./memoryTypes.js";

// Tool
export { OrchidTool, OrchidToolOutput } from "./tool.js";
export type { OrchidToolInput } from "./tool.js";

// Truncation
export { OrchidTruncationStrategy, truncateContent, truncateContentAsync } from "./truncation.js";

// Helpers
export {
    extractUserQuery,
    extractConversationHistory,
    compressConversationHistory,
    summarise,
    fetchRagContext,
    isChatModelLike,
} from "./helpers.js";
export type { ChatModelLike, ConversationMessage, ExtractHistoryOptions } from "./helpers.js";

// Events
export type { SignalEnvelope, Signal, SignalIngestResult } from "./events/signal.js";
export type { JobSpec, JobRun } from "./events/job.js";
export { JobStatus, RetryPolicy } from "./events/job.js";
export { OrchidTrigger, TriggerRegistry } from "./events/trigger.js";
export { OrchidSignalEmitter } from "./events/emitter.js";
export { SignalIngestMiddleware } from "./events/middleware.js";
export { OrchidEventDispatcher, DefaultSignalDispatcher } from "./events/dispatcher.js";
export { OrchidEventProcessor } from "./events/processor.js";
export { OrchidEventProducer } from "./events/producer.js";
export { OrchidSignalQueue, DBTransaction } from "./events/queue.js";
export type { QueuedSignal } from "./events/queue.js";
export { OrchidEventRunner } from "./events/runner.js";
export {
    OrchidSignalStore,
    OrchidJobStore,
    OrchidScheduleStore,
    OrchidTriggerStore,
} from "./events/store.js";
export type { OrchidScheduleRecord, OrchidTriggerRecord } from "./events/store.js";
export {
    OrchidEventsError,
    SignalDuplicateError,
    SignalSourceUnknownError,
    SignalSourceTypeNotAllowedError,
    SignalAuthValidationError,
    TriggerRegistrationError,
    TriggerMatchError,
    JobRunnerError,
    OrchidIdentityNotMintableError,
    ChatBindingError,
    ChatBindingTargetNotFoundError,
    ChatBindingForbiddenError,
} from "./events/errors.js";
