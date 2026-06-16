# orchid-ts/ — AI Context (Framework Library)

## What This Package Is

**`@orchid-ai/orchid`** is the core TypeScript library of the Orchid multi-agent AI framework — the 1:1 port of the
Python `orchid_ai` package. It is an npm-publishable ESM package containing interfaces, `GenericAgent`, LangGraph graph
builder, RAG pipeline, persistence, document parsing, and MCP client. It has **no API endpoints, no CLI, no
vendor-specific code**. Those live in separate packages (`orchid-api-ts/`) or consumer projects.

## Package Structure

```
orchid-ts/
  src/                     Package root (import as `@orchid-ai/orchid` or sub-paths)
    index.ts               SDK surface: OrchidAgent, OrchidAuthContext, buildGraph, loadConfig, …
    bootstrap.ts           Private buildRuntime() / teardownRuntime() — one source of truth
    plugins.ts             Entry-point plugin discovery (Node-friendly: registry + package.json scanner)
    runtime.ts             OrchidRuntime — typed dependency bag for buildGraph()
    utils.ts               importClass() shared utility
    core/                  Pure interfaces — minimal external deps (zod for type contracts)
      agent.ts             OrchidAgent abstract class
      state.ts             OrchidAuthContext + OrchidAgentState
      identity.ts          OrchidIdentityResolver interface (also powers /auth/resolve-identity)
      authConfig.ts        OrchidAuthConfigProvider + OrchidAuthExchangeClient
      mcpInterfaces.ts     OrchidMCPToolCaller / OrchidMCPDiscoverable / OrchidMCPClient
      mcpResult.ts         OrchidMCPToolResult (normalised tool-call result)
      mcpErrors.ts         OrchidMCPAuthRequiredError / OrchidMCPDiscoveryError
      mcpTokens.ts         OrchidMCPTokenStore + OrchidMCPTokenRecord
      mcpRegistration.ts   OrchidMCPClientRegistration + Store
      mcpGatewayState.ts   OrchidMCPGatewayClient/AuthCode/Token Store interfaces
      repository.ts        OrchidVectorReader / OrchidVectorWriter / OrchidVectorStoreAdmin
      scopes.ts            OrchidRAGScope + SHARED_TENANT
      sparse.ts            OrchidSparseEncoder + OrchidSparseVector
      docStore.ts          OrchidDocStore interface
      graphStore.ts        OrchidGraphStore + OrchidEntity / OrchidEdge
      ingestion.ts         OrchidIngestionStrategy + OrchidChunkPostProcessor
      retrieval.ts         OrchidRetrievalStrategy + OrchidQueryTransformer + applyPreStrategy
      guardrails.ts        OrchidGuardrail + OrchidGuardrailChain
      helpers.ts           extractUserQuery / extractConversationHistory / summarise / fetchRagContext
      graphInterrupt.ts    GraphInterrupt class for HITL pause
      pendingInterrupts.ts In-memory pending HITL store
    config/                YAML config loader + zod schemas + tool registry
      schema/               (split via per-domain files: agent, llm, mcp, rag, skills, guardrails, supervisor, mini_agent, prompts, mcp_gateway)
      loader.ts             load_config() with ${VAR} interpolation
      registry.ts           Agent class registry
      toolRegistry.ts       Built-in tool registry
      yamlEnv.ts            applyYamlToEnv() — YAML → env var flattening
    agents/                GenericAgent + collaborators (SkillDetector, MCPDispatcher, SkillExecutor)
                            + agenticLoop + miniAgent{Decomposer,Node,Aggregator} + tools (LangChain wrappers)
    graph/                 LangGraph wiring: builder, supervisor, synthesizer, sequentialAdvancer,
                            supervisorHelpers, miniAgentWrapper, langGraphAdapter, state
    rag/                   Scopes, indexer, embeddings, factory, dynamic, strategies, transformers, sparse, backends
    documents/             Parsers (PDF/DOCX/XLSX/CSV/Image), chunker, pipeline, strategies, postProcessors
    persistence/           OrchidChatStorage + MCP token + registration + gateway-state stores +
                            shared migrations (sqlite + postgres dialects):
      sqlite.ts                       OrchidSQLiteChatStorage (default, better-sqlite3 — core dep)
      postgres.ts                     OrchidPostgresChatStorage (porsager/postgres)
      mcpTokenSqlite.ts               OrchidSQLiteMCPTokenStore
      mcpTokenPostgres.ts             OrchidPostgresMCPTokenStore
      mcpTokenFactory.ts              buildMCPTokenStore()
      mcpClientRegistration*.ts       Per-server discovered endpoints + DCR creds (RFC 7591)
      mcpGatewayState*.ts             3-in-1 inbound gateway-state store (sqlite + postgres)
      migrations/                     Unified v001 + v002 (no-op for parity with Python)
    mcp/                   StreamableHttpMCPClient + OrchidMCPAuthRegistry + OrchidMCPServerInventory
                            + OrchidSessionWarmer + OrchidMCPAuthDiscovery + OrchidOAuthStateStore
    guardrails/            Registry + maxLength / pii / promptInjection / topicRestriction /
                            contentSafety / groundedness
    observability/         OrchidEventBus + OrchidLangChainCallbacks + OrchidMetricsHandler +
                            miniAgentEvents helpers
    checkpointing/         buildCheckpointer() — memory / sqlite / postgres / dotted path
    llm/                   build_chat_model() — provider-first dynamic import
    orchid.ts              Orchid facade — mandatory entry point
  tests/                   Vitest suites
  package.json
```

## Dependency Direction (MUST follow)

```
graph/ → agents/ → core/
         agents/ → rag/ → core/
         agents/ → mcp/ → core/
persistence/ → core/  (standalone)
documents/   → core/  (standalone)
```

`core/` is the pure-interface layer. The only cross-cutting external dep is **zod** (used for the same type-contract
role Python uses Pydantic for in the schema layer). No concrete backend imports (`@qdrant/js-client-rest`, `postgres`,
`@modelcontextprotocol/sdk`) are allowed in `core/`.

## Core Interfaces (`src/core/`)

| Interface / Class                  | File                  | Purpose                                                                                                            |
|------------------------------------|-----------------------|--------------------------------------------------------------------------------------------------------------------|
| `OrchidAgent`                      | `agent.ts`            | Agent identity + `run()`, `summarise()`, `fetchRagContext()`, `extractUserQuery()`, `extractConversationHistory()` |
| `OrchidIdentityResolver`           | `identity.ts`         | Bearer token → `OrchidAuthContext` (also drives `/auth/resolve-identity`)                                          |
| `OrchidAuthConfigProvider`         | `authConfig.ts`       | Resolves non-secret upstream-OAuth discovery for `/auth-info`                                                      |
| `OrchidAuthExchangeClient`         | `authConfig.ts`       | Server-side authorization-code + refresh-token exchange — holds `client_secret`                                    |
| `OrchidMCPToolCaller`              | `mcpInterfaces.ts`    | Call MCP tools                                                                                                     |
| `OrchidMCPDiscoverable`            | `mcpInterfaces.ts`    | Discover MCP capabilities                                                                                          |
| `OrchidMCPTokenStore`              | `mcpTokens.ts`        | Per-user outbound OAuth token persistence                                                                          |
| `OrchidMCPClientRegistrationStore` | `mcpRegistration.ts`  | Per-server discovered endpoints + DCR creds (RFC 7591)                                                             |
| `OrchidMCPGatewayClientStore`      | `mcpGatewayState.ts`  | Inbound DCR client registrations                                                                                   |
| `OrchidMCPGatewayAuthCodeStore`    | `mcpGatewayState.ts`  | Inbound in-flight auth codes                                                                                       |
| `OrchidMCPGatewayTokenStore`       | `mcpGatewayState.ts`  | Inbound issued access + refresh + IdP-token records                                                                |
| `OrchidVectorReader`               | `repository.ts`       | Vector store retrieval                                                                                             |
| `OrchidVectorWriter`               | `repository.ts`       | Vector store indexing                                                                                              |
| `OrchidVectorStoreAdmin`           | `repository.ts`       | Collection management                                                                                              |
| `OrchidChatStorage`                | `persistence/base.ts` | Chat CRUD + message persistence                                                                                    |

**LLM abstraction:** Orchid uses LangChain JS's chat models directly (no custom interface). Use
`buildChatModel(modelString)` factory to create one from a provider/model string (`gemini/gemini-2.5-flash`,
`openai/gpt-4o`, `ollama/llama3.2`, …).

**Document model:** Defined in `core/repository.ts` as `OrchidDocument` (`pageContent`, `metadata`, `id`) — kept
dependency-free; concrete backends round-trip with `@langchain/core/documents` Document.

**Embeddings:** `buildEmbeddings(modelString)` — provider-first dynamic import.

## Key Dependencies

| Package                                                       | Role                                                 | Required?                                                  |
|---------------------------------------------------------------|------------------------------------------------------|------------------------------------------------------------|
| `@langchain/langgraph`                                        | Agent graph framework                                | Optional (auto-detected, fallback to MinimalCompiledGraph) |
| `@langchain/core`                                             | Chat model interfaces, message types                 | Optional (peer dep)                                        |
| `@modelcontextprotocol/sdk`                                   | MCP protocol client (Streamable HTTP + SSE)          | Core                                                       |
| `@qdrant/js-client-rest`                                      | Vector DB client                                     | Core                                                       |
| `better-sqlite3`                                              | SQLite driver (default storage)                      | Core                                                       |
| `postgres` (porsager)                                         | PostgreSQL driver                                    | Core                                                       |
| `zod`                                                         | Runtime schema validation (Pydantic equivalent)      | Core                                                       |
| `yaml`                                                        | YAML parser                                          | Core                                                       |
| `pdf-parse`                                                   | PDF parsing                                          | Core                                                       |
| `mammoth`                                                     | DOCX parsing                                         | Core                                                       |
| `exceljs`                                                     | XLSX parsing                                         | Core                                                       |
| `undici`                                                      | HTTP fetch (MCP discovery, content-safety guardrail) | Core                                                       |
| `@langchain/openai` / `anthropic` / `google-genai` / `ollama` | Provider packages                                    | Optional peer deps                                         |
| `neo4j-driver`                                                | Neo4j graph store                                    | Optional                                                   |

## Architecture Rules

1. **`src/core/` keeps minimal external deps.** Only zod (for type contracts) + framework-internal imports. Every other
   module depends on `core/`. Adding qdrant/sqlite/etc. imports inside `core/` is an architectural bug.

2. **No Qdrant imports outside `rag/backends/`.** All vector access goes through `OrchidVectorReader`/
   `OrchidVectorWriter`/`OrchidVectorStoreAdmin` interfaces in `core/repository.ts`.

3. **Graph-level auth uses passthrough only.** The graph's `OrchidAuthContext` token is obtained ONCE at the API entry
   point. MCP servers with `auth.mode: passthrough` forward this token. MCP servers with `auth.mode: oauth` resolve
   their own per-user tokens from `OrchidMCPTokenStore`. MCP servers with `auth.mode: none` (default) send no auth
   headers.

4. **RAG always uses `OrchidRAGScope`.** Never pass raw `tenantId` filters. 5-level hierarchy: root → tenant → user →
   chat → agent.

5. **Parse-once pattern for documents.** Call `extractText()` once, pass to both prompt builder and
   `ingestDocument({preExtractedText: ...})`.

6. **Imports use `@orchid-ai/orchid` or sub-paths** (`@orchid-ai/orchid/rag`, `@orchid-ai/orchid/persistence`). Never
   relative paths from outside the package.

7. **No vendor-specific code — including in comments and docstrings.** Platform integrations belong in consumer
   projects. Code, comments, doc-comments, and examples inside `orchid-ts/src/` must NEVER reference any concrete
   product, vendor name, or domain-specific object (e.g. specific business entities like "orders", "courses", "
   tickets" — unless used as a purely generic illustrative example that could apply to any integrator). Use
   domain-neutral placeholders (e.g. `knowledge-base`, `search`, `records`, `catalog`) when examples are unavoidable.

8. **Consumer agents extend `OrchidAgent`** and use `this.summarise()`, `this.fetchRagContext()`,
   `OrchidAgent.extractUserQuery()`, `OrchidAgent.extractConversationHistory()` — don't duplicate these methods.

9. **Multi-turn conversation context is handled at framework level.** `OrchidAgent.extractConversationHistory()`
   extracts clean dialogue from graph state. `summarise()` accepts `conversationHistory` and `priorToolContext`. The
   supervisor uses configurable `history_max_turns` (default 20) and `history_max_chars` (default 1000) from
   `OrchidSupervisorConfig`. Opt-in **sliding-window summarization** (`history_summary_enabled`) compresses older turns
   via a cheap LLM call, keeping the most recent `history_summary_recent_turns` (default 10) exchanges verbatim.

10. **MCP communication boundaries swallow errors broadly.** `mcpDispatcher.ts` and `agents/strategies.ts` catch every
    error at server/tool call boundaries — one failing server must not crash the entire agent. HTTP errors (401, 500),
    transport errors, protocol errors all degrade the same way: emit a `[Tool error]` text body and continue.

11. **MCP servers support three auth modes** configured via `auth.mode` in `OrchidMCPServerConfig`: `none` (default — no
    auth headers, for local/unauthenticated servers), `passthrough` (forwards graph `OrchidAuthContext` bearer token),
    `oauth` (per-user tokens from `OrchidMCPTokenStore` with auto-refresh via the discovered token endpoint). The
    `OrchidMCPAuthRegistry` is built once at graph startup from `OrchidAgentsConfig` and exposes which servers require
    OAuth.

12. **Built-in tool parameters are declared in YAML (mandatory in TS port).** The `tools:` section in `agents.yaml`
    requires an explicit `parameters:` block per tool. Auto-extraction from JS function signatures is not reliable
    across runtimes (no equivalent of Python's `inspect`); YAML declarations are authoritative. Framework-injected
    params (`query`, `context`, `auth_context`) are filtered automatically by the dispatcher.

13. **Mini-agents are opt-in via `mini_agent.enabled: true`** on a top-level agent (no nesting). When enabled, a
    deterministic structured-output decomposer runs at the start of the agent's turn; if it returns `shouldFork=true`
    the graph fans out into N parallel mini-agent nodes (default cap 3, hard cap 8) each running a focused agentic loop
    with a curated tool subset, then synthesises their outcomes back into one final response via the aggregator. The
    decomposer hook lives at the **graph-wrapper** level (`graph/miniAgentWrapper.ts`), not inside
    `GenericAgent.run()` — so any `OrchidAgent` subclass can opt in via YAML. Cross-node data uses **shadow-slot keys**:
    `mini_agent_outcomes[${parent}#${miniId}]`, `mini_agent_decisions[parentName]`. Four lifecycle SSE events (
    `mini_agent.{decomposed,started,finished,aggregated}`) flow through `OrchidEventBus`.

## Key Patterns

### Adding an Agent

**YAML only (most common):** Add entry to `agents.yaml`, `GenericAgent` handles everything.

**Custom class:** Subclass `OrchidAgent` in a consumer project, reference via `<modulePath>#<ExportName>` in YAML:

```yaml
class: ./dist/agents/custom.js#CustomAgent
# or
class: @myorg/orchid-extras#CustomAgent
```

### RAG Scoping

```ts
import {makeScope} from '@orchid-ai/orchid';

const scope = makeScope({
    tenantId: auth.tenantKey,
    userId: auth.userId,
    chatId: state.chatId ?? '',
    agentId: this.name,
});
```

### OrchidRuntime (Dependency Bag)

```ts
import {OrchidRuntime, buildGraph, loadConfig} from '@orchid-ai/orchid';
import {ChatOpenAI} from '@langchain/openai';

const runtime = new OrchidRuntime({
    defaultModel: 'gemini/gemini-2.5-flash',
    reader: myQdrantReader,             // or null → NullVectorReader
    chatModel: new ChatOpenAI({model: 'gpt-4o'}),
    mcpClientFactory: myFactory,        // or null → StreamableHttpMCPClient
});
const graph = await buildGraph({
    config: await loadConfig('agents.yaml'),
    runtime,
});
```

Integrators override only what they need. All fields have sensible defaults.

### Strategy Pattern (Tool Calls)

`all`, `sequential`, `llm_decides` are registered strategies. New ones: implement `OrchidToolCallStrategy` +
`registerStrategy(name, factory)`.

### LLM Usage

- **Simple completions** (summarization, routing): Use `this.summarise()` which calls `this._chatModel.invoke()`. A
  `ChatModelLike` must be injected via `chatModel:` — there is no fallback.
- **Agentic tool-calling loops** (need `tool_calls` response): Use the `AgenticLoop` from `agents/agenticLoop.ts` — it
  handles `bindTools`, duplicate detection, parallel-safe dispatch, and HITL interrupts.
- **Custom direct invocations**: Always go through the injected `_chatModel`. Don't import provider SDKs at module level
  in consumer agents.

## Testing

```bash
cd orchid-ts
npm install
npm test                    # all tests via vitest
npm test -- scopes          # specific match
npm run lint                # eslint + tsc --noEmit
npm run format              # prettier
```

## Embedding Dimensions (Critical for Qdrant)

| Model                       | Dimensions |
|-----------------------------|------------|
| ollama/nomic-embed-text     | 768        |
| text-embedding-3-small      | 1536       |
| gemini/gemini-embedding-001 | 3072       |

Switching models requires wiping and re-indexing Qdrant collections.

## MCP Gateway Exposure Config (Optional)

`OrchidAgentsConfig.mcp_gateway` lets integrators customise how Orchid's MCP-facing gateway presents itself to host
LLMs:

- **Tool overrides** — replace default `title` / `description` for specific tool names.
- **MCP Prompts** — pre-canned templates with `{{var}}` substitution.

The block is **entirely optional** — a YAML without `mcp_gateway:` parses into an empty config (`default()` from zod),
and nothing in `orchid-ts/` depends on it being populated. Data-only: the framework library does not render templates or
track which tools a gateway actually exposes.

```yaml
mcp_gateway:
  tools:
    orchid_ask:
      title: "Ask the Acme Knowledge Base"
      description: "Route a question to the Acme support agents."
  prompts:
    - name: compliance_report
      description: "Generate a compliance-completion report."
      arguments:
        - { name: department, required: true }
      template: |
        Produce a compliance report for {{department}}.
```

Classes live in `src/config/mcpGateway.ts`. Env-var overrides + external prompts-file loading happen upstream in
`orchid-api-ts`'s router.

## Auth-centralisation Interfaces

The framework library carries the abstract auth surface; concrete implementations live in consumer projects.

- `OrchidAuthConfigProvider` resolves the non-secret upstream-OAuth discovery shape (`OrchidUpstreamOAuthConfig`)
  consumed by `orchid-api-ts`'s `/auth-info`. Pure: no network calls, no side effects; reads env vars seeded from
  `orchid.yml`.
- `OrchidAuthExchangeClient` holds the upstream `client_secret` and performs the authorization-code (`exchangeCode`) and
  refresh-token (`refreshToken`) grants on behalf of downstream public PKCE clients. `refreshToken` is optional in the
  interface — exchange-only consumers don't break, and the `/auth-info` flag gating `refresh_via_api` checks the
  method's presence on the wired client.
- Three `OrchidMCPGatewayClient/AuthCode/Token Store` interfaces back the inbound MCP gateway's OAuth state. One
  concrete class implements all three against the shared chat DB (SQLite / Postgres). `OrchidMCPGatewayToken` carries
  `idpAccessToken` + `idpRefreshToken` + `idpExpiresAt` so the refresh path has the upstream pair to swap.
- `OrchidIdentityResolver` does double-duty: per-request bearer validation AND the upstream-token → identity bridge
  exposed at `/auth/resolve-identity`.

## Common Pitfalls

- **Importing `@qdrant/js-client-rest` in agent code.** Use `this.reader.retrieve(...)` instead.
- **Using `filters: object` instead of `scope: OrchidRAGScope`** in retrieval calls.
- **Passing `tenantId` directly** — use `auth.tenantKey` (defaults to `"default"`).
- **Not handling `reader` being `null`** — vector backend can be `NullVectorReader` in tests.
- **Mutating `OrchidAuthContext`** — it's subclass-friendly but treat as immutable in framework code.
- **Adding API/CLI code here** — those belong in `orchid-api-ts/`.
- **Catching narrow exception types at MCP boundaries** — always catch `unknown` / `Error` at server communication
  boundaries. The `@modelcontextprotocol/sdk` raises a variety of error types that don't share a common base; a narrow
  catch lets them propagate and crash the agent.
- **Adding HTTP/fetch logic to `OrchidAuthConfigProvider`** — it's a pure config-resolution interface. Network calls to
  validate the discovery block happen one layer up in `orchid-api-ts`'s router.
- **Forgetting `bootstrap.ts` is private.** Use `Orchid.fromConfigPath()` from `orchid.ts`; `buildRuntime()` is an
  implementation detail and may break between minor versions.
