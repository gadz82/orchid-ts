# @orchid-ai/orchid

A platform-agnostic multi-agent AI framework — the TypeScript port of [`orchid-ai`](https://github.com/gadz82/orchid) (Python). Built on [LangGraph.js](https://github.com/langchain-ai/langgraphjs) and [LangChain chat models](https://github.com/langchain-ai/langchainjs).

Orchid (alias for Orchestrator-Index) lets you define AI agents via YAML configuration, orchestrate them with a supervisor, connect external tools via MCP servers, and augment responses with hierarchical RAG — all without writing agent code.

## BETA — This is a work in progress.

## Features

- **YAML-driven agents** — define agents, tools, skills, and prompts in `agents.yaml`
- **Markdown-driven agents** — define agents in `orchid.md` + `agents/*.md` with rich Markdown prompts, YAML frontmatter, and hot-reload support
- **Multi-provider LLM** — OpenAI, Anthropic, Google Gemini, Groq, Ollama via LangChain chat models
- **Hierarchical RAG** — 5-level scoping (shared, tenant, user, chat, agent) with Qdrant, ChromaDB, and Neo4j backends
- **Pluggable retrieval strategies** — `simple`, `multi_query`, `hyde`, `hybrid`, `graph_rag` plus integrator-registered custom strategies
- **Pluggable query transformers** — `reformulate`, `multi_query`, `hyde`, `decompose`, all with configurable system prompts
- **MCP tool integration** — connect to external services via Streamable HTTP MCP servers, with `none` / `passthrough` / `oauth` auth modes (OAuth covers RFC 9728 / RFC 8414 / RFC 7591 DCR)
- **Built-in tools** — register JS/TS functions as in-process tools, with declarative parameter metadata (mandatory in the TS port — function-signature introspection is not reliable across runtimes)
- **Agent skills** — multi-step workflows within agents and across agents (orchestrator skills)
- **Mini-agents (self-clone fork)** — opt-in per-agent decomposer + aggregator that fan a single turn into independent sub-tasks running in parallel
- **Parallel tool dispatch** — opt-in intra-round parallel tool calls based on per-tool `parallelSafe` annotations
- **Per-tool RAG caching** — opt-in `injectToRag` with configurable TTL per tool
- **Internal prompt customisation** — every supervisor / synthesis / agent / RAG-transformer / mini-agent / summarise prompt is YAML- and TS-configurable with backwards-compatible defaults
- **Sliding-window history summarisation** — opt-in compression of older turns by a cheaper LLM so long conversations stay within budget
- **AI Guardrails** — 3-tier safety layer (global input, per-agent, global output) with built-in prompt injection, PII, content safety, topic restriction, max length, and groundedness checks
- **Pluggable persistence** — SQLite (default, `better-sqlite3`) and PostgreSQL (porsager/postgres) backends for chat history; integrators can plug any `OrchidChatStorage` subclass
- **HITL graph interrupts** — `requiresApproval: true` tools pause the graph; resume via the API or CLI with the user's decision
- **MCP capability cache warming** — `OrchidSessionWarmer` keeps tool inventories ready so the first agentic round avoids discovery RPCs
- **Pollen & Bloom (event-driven activation)** — opt-in async substrate that turns external webhooks, cron schedules, and in-graph `emitSignal` calls into background LangGraph runs
- **Document pipeline** — PDF, DOCX, XLSX, CSV, image parsing with pluggable ingestion strategies and post-processors

## Installation

```bash
npm install @orchid-ai/orchid
```

With PostgreSQL / Qdrant / ChromaDB / Neo4j support (optional peer / workspace packages):

```bash
npm install @orchid-ai/storage-postgres
npm install @orchid-ai/rag-qdrant
npm install @orchid-ai/rag-chroma
npm install @orchid-ai/rag-neo4j
```

Optional LLM providers (peer dependencies — install only the ones you use):

```bash
npm install @langchain/openai @langchain/anthropic @langchain/google-genai @langchain/ollama
```

## Dependency Matrix

The core `@orchid-ai/orchid` library ships with `null` and `in_memory` backends only — no Qdrant, no PostgreSQL, no ChromaDB, no Neo4j. Concrete backends live in **separate workspace packages** that auto-register via Node entry points. Install only what your configuration needs:

| If your config uses this… | Install this | Required by |
|---|---|---|
| `rag.vectorBackend: qdrant` | `npm install @orchid-ai/rag-qdrant` | Qdrant vector + doc store |
| `rag.vectorBackend: chroma` | `npm install @orchid-ai/rag-chroma` | ChromaDB on-disk vector store |
| `rag.vectorBackend: neo4j` | `npm install @orchid-ai/rag-neo4j` | Neo4j graph store |
| `storage.class: @orchid-ai/storage-postgres/*` | `npm install @orchid-ai/storage-postgres` | PostgreSQL chat persistence |
| `checkpointer.type: postgres` | `npm install @orchid-ai/storage-postgres` | LangGraph checkpointing |
| Events with PostgreSQL backends | `npm install @orchid-ai/storage-postgres` | Postgres signal queue + event storage |

The version constraint (`@orchid-ai/orchid>=X.Y.Z`) is declared in each plugin's
`package.json` and enforced by npm at install time. At runtime, the
plugin's `register()` function safely skips registration when the
expected framework symbols are missing (graceful downgrade).

Missing a plugin that your config references raises a clear error at
startup, e.g.:

```
Unknown vector backend 'qdrant'. Install the missing
plugin: npm install @orchid-ai/rag-qdrant. Registered built-ins: ['null'].
```

## Quick Start

### 1. Define Agents

Create an `agents.yaml`:

```yaml
version: "1"

defaults:
  llm:
    model: ollama/llama3.2
    temperature: 0.2

agents:
  assistant:
    description: "General-purpose assistant"
    prompt: |
      You are a helpful AI assistant.
      Answer questions clearly and concisely.
```

### 2. Use Programmatically

`Orchid` is the **single entry point** — it loads config, wires the graph, and
runs turns. Call `close()` when done so DB / checkpointer connections shut
down cleanly.

```ts
import { Orchid, OrchidAuthContext } from "@orchid-ai/orchid";

const orchid = await Orchid.fromConfigPath("agents.yaml");

const auth = new OrchidAuthContext({
  accessToken: "<bearer>",
  tenantKey: "acme",
  userId: "alice",
});

const result = await orchid.invoke(
  {
    messages: [{ role: "user", content: "Hello!" }],
    chatId: "chat-1",
    activeAgents: [],
    mcpContext: {},
    ragContext: {},
    finalResponse: null,
    skillInstructions: {},
    _hasOutputGuardrails: false,
  },
  { configurable: { thread_id: "chat-1", auth_context: auth } },
);

console.log(result.response);
await orchid.close();
```

`fromConfigPath` auto-detects YAML (`agents.yaml`) vs Markdown (`orchid.md`)
and accepts overrides (`model=`, `vectorBackend=`, `qdrantUrl=`, …) via
`OrchidFactoryOverrides`. Auth is **execution context, not graph state**: pass
an `OrchidAuthContext` through the LangGraph `RunnableConfig`
(`config.configurable.auth_context`) and the framework attaches it to the run
config — it is never written to a checkpoint. For a fully custom runtime,
build an `OrchidRuntime` and pass it to `Orchid.fromConfig(config, overrides)`
(see [OrchidRuntime](#orchidruntime)).

### 3. Or Use via @orchid-ai/cli / @orchid-ai/api / @orchid-ai/mcp

This library is consumed by:

- **[@orchid-ai/api](https://github.com/gadz82/orchid-api-ts)** — Fastify HTTP server
- **[@orchid-ai/cli](https://github.com/gadz82/orchid-cli-ts)** — Commander-based CLI
- **[orchid-frontend](https://github.com/gadz82/orchid-frontend)** — Next.js chat UI
- **[@orchid-ai/mcp](https://github.com/gadz82/orchid-mcp)** — MCP gateway for Claude Desktop/Cursor
- **[orchid-examples](https://github.com/gadz82/orchid-examples)** — Example configurations and custom agents

## Architecture

```
src/
  core/             Pure interfaces — minimal external deps (zod + stdlib)
    agent.ts        OrchidAgent abstract class
    state.ts        OrchidAuthContext + OrchidAgentState
    identity.ts     OrchidIdentityResolver interface
    authConfig.ts   OrchidAuthConfigProvider + OrchidAuthExchangeClient
    mcpInterfaces.ts OrchidMCPToolCaller / OrchidMCPDiscoverable interfaces
    mcpTokens.ts    OrchidMCPTokenStore + OrchidMCPTokenRecord
    mcpRegistration.ts OrchidMCPClientRegistration + Store
    mcpGatewayState.ts 3-in-1 inbound gateway-state store interface
    repository.ts   OrchidVectorReader / OrchidVectorWriter / OrchidVectorStoreAdmin
    retrieval.ts    OrchidRetrievalStrategy + OrchidQueryTransformer
    guardrails.ts   OrchidGuardrail + OrchidGuardrailChain
    events/         Pure event-substrate ABCs (zero external deps)
  config/           YAML/Markdown config loader + zod schemas + registries
  agents/           GenericAgent + collaborators (SkillDetector, MCPDispatcher, SkillExecutor,
                    AgenticLoop, MiniAgentDecomposer/Node/Aggregator)
  graph/            LangGraph builder + supervisor + synthesizer + sequential advancer +
                    miniAgentWrapper + langGraphAdapter
  rag/              Scopes, indexer, embeddings, factory, dynamic, strategies, transformers,
                    sparse, backends (null + inMemory)
  documents/        PDF/DOCX/XLSX/CSV/Image parsers + chunking pipeline
  persistence/      OrchidChatStorage interface + SQLite (better-sqlite3) + Postgres
                    (porsager/postgres) + shared migrations
  mcp/              StreamableHttpMCPClient + OrchidMCPAuthRegistry + OrchidSessionWarmer +
                    OrchidMCPAuthDiscovery + OrchidOAuthStateStore
  events/           Pollen + Bloom — concrete impls of core/events ABCs:
                    backends/, queues/, processors/, runners/, producers/,
                    schedulers/, auth/, registry, ingestion, streaming, visibility
  identity/         OAuthMintingMixin (helper for resolvers used by act_as triggers)
  llm/              buildChatModel() — provider-first dynamic import
  guardrails/       Registry + maxLength / pii / promptInjection / topicRestriction /
                    contentSafety / groundedness
  observability/    OrchidEventBus + OrchidLangChainCallbacks + OrchidMetricsHandler +
                    miniAgentEvents helpers
  checkpointing/    buildCheckpointer() — memory / sqlite / postgres / dotted path
  orchid/           Orchid facade — mandatory entry point
```

### Dependency Direction

```
graph/   -> agents/ -> core/
            agents/ -> rag/   -> core/
            agents/ -> mcp/   -> core/
            agents/ -> events/ -> core/
persistence/ -> core/
documents/   -> core/
```

`core/` is the leaf — it has ZERO non-zod external dependencies. The only
cross-cutting external dep is **zod** (used for the same type-contract
role Python uses Pydantic for in the schema layer).

## Core Interfaces

| Interface / Class                  | File                  | Purpose                                                                                                            |
|------------------------------------|-----------------------|--------------------------------------------------------------------------------------------------------------------|
| `OrchidAgent`                      | `core/agent.ts`       | Agent identity + `run()`, `summarise()`, `fetchRagContext()`, `extractUserQuery()`, `extractConversationHistory()` |
| `OrchidIdentityResolver`           | `core/identity.ts`    | Bearer token → `OrchidAuthContext` (per-request validation **and** the `/auth/resolve-identity` bridge)            |
| `OrchidAuthConfigProvider`         | `core/authConfig.ts`  | Resolves non-secret upstream-OAuth discovery for `/auth-info`                                                      |
| `OrchidAuthExchangeClient`         | `core/authConfig.ts`  | Server-side authorization-code + refresh-token exchange — holds `client_secret`                                    |
| `OrchidMCPToolCaller`              | `core/mcpInterfaces.ts` | Call MCP tools                                                                                                   |
| `OrchidMCPDiscoverable`            | `core/mcpInterfaces.ts` | Discover MCP capabilities                                                                                        |
| `OrchidMCPTokenStore`              | `core/mcpTokens.ts`   | Per-user outbound OAuth token persistence                                                                          |
| `OrchidMCPClientRegistrationStore` | `core/mcpRegistration.ts` | Per-server discovered endpoints + DCR creds (RFC 7591)                                                         |
| `OrchidMCPGatewayClientStore` / `…AuthCodeStore` / `…TokenStore` | `core/mcpGatewayState.ts` | Inbound MCP gateway state (DCR clients, in-flight auth codes, issued tokens)              |
| `OrchidVectorReader`               | `core/repository.ts`  | Vector store retrieval                                                                                             |
| `OrchidVectorWriter`               | `core/repository.ts`  | Vector store indexing                                                                                              |
| `OrchidVectorStoreAdmin`           | `core/repository.ts`  | Collection management                                                                                              |
| `OrchidDocStore`                   | `core/docStore.ts`    | Document store (chunk payloads, doc-id lookups)                                                                    |
| `OrchidGraphStore`                 | `core/graphStore.ts`  | Graph store (entities + edges)                                                                                     |
| `OrchidChatStorage`                | `persistence/base.ts` | Chat CRUD + message persistence                                                                                    |
| `OrchidSignalDispatcher`           | `core/events/dispatcher.ts` | Persist + enqueue a `SignalEnvelope` (Pollen ingest)                                                          |
| `OrchidSignalQueue`                | `core/events/queue.ts` | Durable signal buffer (in-memory / SQLite / Postgres / relay)                                                     |
| `OrchidSignalProducer`             | `core/events/producer.ts` | Surface external events as signals (HTTP / scheduler / internal)                                              |
| `OrchidSignalProcessor`            | `core/events/processor.ts` | Drain the queue, match triggers, execute Blooms                                                                |
| `OrchidJobRunner`                  | `core/events/runner.ts` | Invoke the LangGraph supervisor under a synthesised auth context                                                  |
| `OrchidSignalStore` / `OrchidJobStore` / `OrchidScheduleStore` / `OrchidTriggerStore` | `core/events/store.ts` | Per-table stores backing the events tables                                              |

The auth ABCs (`OrchidAuthConfigProvider`, `OrchidAuthExchangeClient`,
`OrchidIdentityResolver`, three `OrchidMCPGateway*Store`s) collectively let
`@orchid-ai/api` host every secret-bearing OAuth call on behalf of downstream
public PKCE clients (the MCP gateway, Next.js frontends).

## OrchidRuntime

`OrchidRuntime` is the **advanced customization point** — it holds the resolved
dependencies the `Orchid` facade wires together (chat model, vector reader,
MCP client factory, persistence). `Orchid.fromConfigPath` builds one for you
from `agents.yaml`; override only what you need and pass it to
`Orchid.fromConfig(config, overrides)` when you want full programmatic control.
(`buildGraph()` is the low-level builder the facade calls under the hood —
import it from `@orchid-ai/orchid/graph` if you really need it directly.)

```ts
import {
  Orchid,
  OrchidRuntime,
  loadConfig,
} from "@orchid-ai/orchid";
```

### Minimal (all defaults)

Uses a LangChain chat model for LLM, `NullVectorReader` (no RAG), and
`StreamableHttpMCPClient` for MCP servers:

```ts
import { ChatOllama } from "@langchain/ollama";

const config = loadConfig("agents.yaml");
const orchid = await Orchid.fromConfig(config, {
  defaultModel: "ollama/llama3.2",
  chatModel: new ChatOllama({ model: "llama3.2" }),
});
```

### Custom Vector Store

Plug in a Qdrant-backed reader (or any `OrchidVectorReader` implementation):

```ts
import { buildReader } from "@orchid-ai/orchid/rag";

const reader = buildReader({
  vectorBackend: "qdrant",
  qdrantUrl: "http://localhost:6333",
});

const orchid = await Orchid.fromConfig(config, {
  defaultModel: "gemini/gemini-2.5-flash",
  reader,
});
```

### Custom LLM Provider

Replace the default LangChain chat model with your own `BaseChatModel`
implementation:

```ts
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";

class MyProvider extends BaseChatModel {
  override lc_namespace = ["my", "provider"];

  async _generate(messages, _options, _runManager) {
    // your custom logic
    return { generations: [{ text: "...", message: new AIMessage("...") }] };
  }

  override _llmType() {
    return "my-provider";
  }
}

const orchid = await Orchid.fromConfig(config, {
  defaultModel: "my-model",
  chatModel: new MyProvider(),
});
```

### Custom MCP Client Factory

Control how MCP clients are created from server config entries:

```ts
import type { OrchidMCPServerConfig } from "@orchid-ai/orchid/core";
import type { OrchidMCPClient } from "@orchid-ai/orchid/core";

const orchid = await Orchid.fromConfig(config, {
  defaultModel: "ollama/llama3.2",
  mcpClientFactory: (cfg: OrchidMCPServerConfig): OrchidMCPClient =>
    MyMCPClient(cfg.url, { apiKey: process.env.MY_KEY }),
});
```

### All Options

```ts
import { OrchidRuntime } from "@orchid-ai/orchid";
import { ChatOpenAI } from "@langchain/openai";

const runtime = new OrchidRuntime({
  defaultModel: "openai/gpt-4o",          // LangChain model identifier
  reader: myQdrantReader,                 // OrchidVectorReader | null
  writer: myQdrantWriter,                 // OrchidVectorWriter | null
  docStore: myDocStore,                   // OrchidDocStore | null
  graphStore: myGraphStore,               // OrchidGraphStore | null
  chatModel: new ChatOpenAI({ model: "gpt-4o" }), // BaseChatModel | null
  mcpClientFactory: myFactory,            // ((OrchidMCPServerConfig) => OrchidMCPClient) | null
  mcpTokenStore: myTokenStore,            // OrchidMCPTokenStore | null
  mcpClientRegistrationStore: myRegStore, // OrchidMCPClientRegistrationStore | null
  mcpGatewayStateStore: myGwStateStore,   // OrchidMCPGatewayClient/AuthCode/Token Store | null
  chatStorage: myStorage,                 // OrchidChatStorage | null
  checkpointer: myCheckpointer,           // langgraph checkpointer | null
  signalEmitter: myEmitter,               // custom OrchidSignalEmitter
});
const orchid = await Orchid.fromConfig(config, runtime);
```

| Field | Type | Default |
|-------|------|---------|
| `defaultModel` | `string` | `""` (must be set explicitly) |
| `reader` | `OrchidVectorReader \| null` | `NullVectorReader` (no RAG) |
| `writer` | `OrchidVectorWriter \| null` | `null` |
| `docStore` | `OrchidDocStore \| null` | `NullDocStore` |
| `graphStore` | `OrchidGraphStore \| null` | `NullGraphStore` |
| `chatModel` | `BaseChatModel \| null` | `null` (must be set or `defaultModel` must resolve) |
| `mcpClientFactory` | `((OrchidMCPServerConfig) => OrchidMCPClient) \| null` | `StreamableHttpMCPClient` factory |
| `mcpTokenStore` | `OrchidMCPTokenStore \| null` | `null` |
| `chatStorage` | `OrchidChatStorage \| null` | `null` (in-memory only) |

## Configuration

Orchid uses two configuration files:

- **`agents.yaml`** — Agent definitions, tools, skills, and supervisor (managed by the library)
- **`orchid.yml`** — Runtime settings for LLM, RAG, storage, auth, and tracing (managed by `@orchid-ai/api` / `@orchid-ai/cli`)

**Priority:** env vars > `orchid.yml` > hardcoded defaults.

> **Naming note:** The TypeScript port uses **camelCase** YAML keys
> (`toolCallStrategy`, `ragTtl`, `promptSections`, `executionHints`,
> `historySummaryEnabled`, …) to match the underlying zod schema and idiomatic
> TypeScript. The Python port uses `snake_case` (`tool_call_strategy`,
> `rag_ttl`, …). The two configs are semantically identical; only the
> key naming convention differs.

---

### agents.yaml Reference

#### Root Level

| Field | Type | Default |
|-------|------|---------|
| `version` | `string` | `"1"` |
| `defaults` | `object` | `{}` |
| `tools` | `record` | `{}` |
| `skills` | `record` | `{}` |
| `supervisor` | `object` | (defaults) |
| `guardrails` | `object` | `{input: [], output: []}` |
| `agents` | `record` | (required) |
| `events` | `object \| null` | `null` |
| `mcpGateway` | `object` | `{tools: {}, prompts: []}` |

- **`version`** — Schema version string. Currently always `"1"`. Reserved for future backward-compatible migrations.
- **`defaults`** — Default LLM and RAG settings inherited by every agent. Agents can override any default individually. Avoids repeating the same model or RAG config across all agents.
- **`tools`** — Global registry of built-in TS/JS tools. Each tool is a named entry mapping to a callable. Agents reference tools by name in their `tools` list. Tools declared here are available to any agent that includes their name.
- **`skills`** — Orchestrator-level (cross-agent) multi-step workflows. The supervisor detects when a user query matches a skill and runs agents in sequence, passing results forward. Useful for complex tasks that span multiple domains (e.g. "plan a trip" involving flights + hotels + activities).
- **`supervisor`** — Customization of the supervisor node that routes queries to agents, synthesizes multi-agent responses, and manages orchestrator skills. Override prompts here to change routing logic without modifying code.
- **`guardrails`** — Global input and output guardrail chains. Input guardrails run on every user message before the supervisor; output guardrails run on every response before returning to the user. See "Guardrails" section below.
- **`agents`** — The core of the config: a dictionary of agent definitions keyed by name. Each agent is a self-contained unit with its own prompt, tools, MCP connections, RAG settings, guardrails, and skills. At least one agent is required.
- **`events`** — Top-level block that wires the event-driven activation layer (Pollen + Bloom). Omit it (or set `events.enabled: false`) and nothing in `@orchid-ai/orchid/events/` runs — zero overhead. See "Advanced features → Pollen + Bloom" below.
- **`mcpGateway`** — Optional block that customises how Orchid is presented to MCP clients via the `orchid-mcp` gateway (tool title/description overrides + MCP Prompt templates). The block is entirely optional — empty by default, ignored when not populated. See "MCP gateway exposure" below.

#### `defaults.llm`

| Field | Type | Default |
|-------|------|---------|
| `model` | `string` | `"gemini/gemini-2.5-flash"` |
| `temperature` | `number` | `0.2` |
| `fallbackModel` | `string \| null` | `null` |
| `retryAttempts` | `number` | `0` |

- **`model`** — The LLM model identifier in `provider/model-name` format. The default model used by all agents unless overridden per-agent. Supported providers: `ollama/llama3.2` (local), `openai/gpt-4o`, `anthropic/claude-sonnet-4-20250514`, `gemini/gemini-2.5-flash`, `groq/llama-3.3-70b-versatile`, plus any LangChain chat model.
- **`temperature`** — Sampling temperature. `0.0` = fully deterministic, `2.0` = maximum randomness. Lower values (`0.1`–`0.3`) are best for factual/tool-calling agents. Higher values (`0.7`–`0.9`) suit creative tasks. Default `0.2` favors consistency.
- **`fallbackModel`** — Optional fallback LLM model. When set, the framework automatically retries with this model if the primary model fails (503, rate limit, timeout). Disabled by default (`null`).
- **`retryAttempts`** — Number of automatic retry attempts for transient LLM errors. Default `0` (no retries).

#### `defaults.rag`

| Field | Type | Default |
|-------|------|---------|
| `k` | `number` | `5` |
| `enabled` | `boolean` | `true` |
| `ragTtl` | `number` | `0` |
| `retrieval.strategy` | `string` | `"simple"` |
| `retrieval.transformers` | `string[]` | `[]` |

- **`k`** — Maximum number of documents retrieved from the vector store per agent query. The agent embeds the user's query, performs a similarity search, and injects the top `k` chunks into the LLM prompt as context. Higher values give more context but cost more tokens.
- **`enabled`** — Master switch for RAG retrieval across all agents. When `false`, no agent queries the vector store and no dynamic injection occurs. Individual agents can override this.
- **`ragTtl`** — Default time-to-live (in seconds) for tool results cached in RAG. When a tool has `injectToRag: true`, its results are stored with a timestamp. On subsequent queries, if cached results exist that are newer than `ragTtl` seconds ago, the framework reuses them instead of re-calling the tool. `0` = caching disabled.
- **`retrieval.strategy`** — Which retrieval strategy to use by default. Built-ins: `simple`, `multi_query`, `hyde`, `hybrid`, `graph_rag`. Integrators can register custom strategies.
- **`retrieval.transformers`** — Ordered list of query transformers to run before retrieval. Built-ins: `reformulate`, `multi_query`, `hyde`, `decompose`. Each has a configurable system prompt.

#### `supervisor`

| Field | Type | Default |
|-------|------|---------|
| `assistantName` | `string` | `"AI assistant"` |
| `fallbackModel` | `string \| null` | `null` |
| `routingSystemPrompt` | `string \| null` | `null` |
| `synthesisSystemPrompt` | `string \| null` | `null` |
| `sequentialAdvancePrompt` | `string \| null` | `null` |
| `historyMaxTurns` | `number` | `20` |
| `historyMaxChars` | `number` | `1000` |
| `historySummaryEnabled` | `boolean` | `true` |
| `historySummaryModel` | `string \| null` | `null` |
| `historySummaryRecentTurns` | `number` | `10` |

- **`assistantName`** — The name used in the supervisor's prompts when referring to itself (e.g. "You are the routing brain of **Travel Assistant**"). Appears in synthesized responses. Set this to your product's name.
- **`fallbackModel`** — Optional fallback LLM for the supervisor specifically. Overrides `defaults.llm.fallbackModel` for routing, synthesis, and sequential advance calls.
- **`routingSystemPrompt`** — Fully custom system prompt for the supervisor's routing step. When `null`, the built-in template from `graph/supervisor.ts` is used.
- **`synthesisSystemPrompt`** — Custom system prompt for the synthesis step. After all selected agents return their results, the supervisor synthesizes them into a single coherent response.
- **`sequentialAdvancePrompt`** — Custom prompt used during orchestrator skill execution. After each step in a multi-agent skill completes, this prompt decides whether to advance to the next step or respond directly.
- **`historyMaxTurns`** — Maximum number of user-assistant conversation pairs included as context in supervisor routing, synthesis, and sequential advance steps. Default `20`.
- **`historyMaxChars`** — Maximum characters per individual message in conversation history. Messages exceeding this limit are truncated with an ellipsis (`…`). Default `1000`.
- **`historySummaryEnabled`** — Enables sliding-window conversation summarization. When `true`, conversation turns older than `historySummaryRecentTurns` are compressed into a single LLM-generated summary paragraph, while the most recent turns are kept verbatim. Default `true`.
- **`historySummaryModel`** — LLM model used for the history summarization call. Use a cheap/fast model here since the summarization input is small. When `null`, the supervisor's default model is used.
- **`historySummaryRecentTurns`** — Number of recent user-assistant exchange pairs to keep verbatim when summarization is enabled. Older turns are condensed into a summary. Default `10`.

#### `tools.<name>` (Built-in Tools)

| Field | Type | Default |
|-------|------|---------|
| `class` | `string` | (one of `class`/`handler` required) |
| `handler` | `string` | (one of `class`/`handler` required) |
| `description` | `string` | `""` |
| `parameters` | `record` | `{}` |
| `injectToRag` | `boolean` | `false` |
| `ragTtl` | `number \| null` | `null` |

- **`class`** — Dotted import path to an `OrchidTool` subclass registered via `registerTool()` (e.g. `"myapp.tools.weather.WeatherTool"`). The class is loaded via dynamic import at graph build time. Exactly one of `class` or `handler` is required.
- **`handler`** — Dotted import path to a plain callable (e.g. `"myapp.tools.weather.getWeather"`). The function must be importable from the working directory and must accept a `{ query, context, authContext }` argument bag. Exactly one of `class` or `handler` is required.
- **`description`** — Human-readable description of what the tool does. Included in the LLM prompt so the model understands when to call it. Be specific: "Get current weather temperature and conditions for a city name" is better than "Weather tool".
- **`parameters`** — **Required** in the TypeScript port (auto-extraction from JS function signatures is not reliable across runtimes). Each parameter is an object with `type` (`string` / `number` / `boolean`), `description`, `required` (boolean), and `default`. Framework-injected params (`query`, `context`, `authContext`) are filtered automatically.
- **`injectToRag`** — When `true`, the tool's return value is stored as a document in the vector store after execution. Creates a cache: on future queries, the framework can retrieve the cached result from RAG instead of re-calling the tool (if `ragTtl > 0`). Default `false`.
- **`ragTtl`** — Per-tool override for the RAG cache TTL (in seconds). When `null`, the agent's `rag.ragTtl` is used. When `0`, caching is disabled for this tool. When a positive integer, cached results expire after that many seconds.

#### `skills.<name>` (Orchestrator Skills)

| Field | Type | Default |
|-------|------|---------|
| `description` | `string` | `""` |
| `steps` | `list` | (required) |

- **`description`** — Human-readable description of the entire workflow. The supervisor's LLM reads this to decide whether to activate the skill for a given user query. Write it as a summary of the end-to-end outcome: "Plan a complete trip: find flights, book hotels, and suggest activities at the destination."
- **`steps`** — Ordered list of agent invocations. Each step runs one agent, and the results are passed to the next step as context. Steps execute sequentially — the output of step 1 is available to step 2's agent.

Each step:

| Field | Type |
|-------|------|
| `agent` | `string` |
| `instruction` | `string` |

- **`agent`** — Name of the agent to invoke (must match a key in the `agents` dict).
- **`instruction`** — Specific instruction or question passed to the agent for this step. This overrides the user's original query for this step. For example: "Based on the flight results, find hotels near the airport for those dates."

#### `agents.<name>`

| Field | Type | Default |
|-------|------|---------|
| `description` | `string` | (required) |
| `prompt` | `string` | (required) |
| `class` | `string` | `null` |
| `llm` | `object` | (from defaults) |
| `rag` | `object` | (from defaults) |
| `tools` | `string[]` | `[]` |
| `mcpServers` | `list` | `[]` |
| `skills` | `record` | `{}` |
| `guardrails` | `object` | `{}` |
| `promptSections` | `object` | (defaults) |
| `executionHints` | `object` | (defaults) |
| `children` | `record \| null` | `null` |
| `memory` | `object` | (see Memory) |
| `miniAgent` | `object` | `{enabled: false}` |

- **`description`** — Short description of the agent's domain and capabilities. The supervisor reads this to decide which agent(s) should handle a user's query. Write it from the supervisor's perspective: "Flight search and booking agent. Searches airlines, compares prices, and can hold reservations."
- **`prompt`** — The system prompt sent to the LLM when this agent runs. Defines the agent's personality, expertise, and behavior rules.
- **`class`** — Dotted import path (with optional `#ExportName` suffix) to a custom `OrchidAgent` subclass (e.g. `"./dist/agents/hotels.js#HotelAgent"`). When `null` (the default), the built-in `GenericAgent` is used, which handles the standard agentic loop (RAG retrieval, skill check, MCP tools, built-in tools, dynamic injection, LLM summarization) entirely from YAML config. Only set this when you need custom TS logic that `GenericAgent` can't express.
- **`llm`** — Per-agent LLM override with `model`, `temperature`, and `fallbackModel`. When set, this agent uses a different model than the default.
- **`rag`** — Per-agent RAG settings (see `agents.<name>.rag` below).
- **`tools`** — List of built-in tool names (strings) available to this agent.
- **`mcpServers`** — List of MCP server connections (see `agents.<name>.mcpServers[]` below).
- **`skills`** — Agent-level multi-step workflows (see `agents.<name>.skills.<name>` below).
- **`guardrails`** — Per-agent input and output guardrail chains. Run in addition to global guardrails when this specific agent is active.
- **`promptSections`** — Per-agent override of internal prompt section templates (resource header, RAG header, prior-results header, etc.) — see "Internal prompt customisation" below.
- **`executionHints`** — Hints the supervisor uses when routing. Currently only `parallelSafe` (see below).
- **`children`** — Recursive sub-agent definitions. Sub-agents inherit the parent's defaults and are included in the supervisor's routing. Useful for organizing related agents hierarchically.
- **`memory`** — Per-agent cross-chat memory (namespace, retrieval k, similarity threshold, store turns). See `defaults.memory` for the schema.
- **`miniAgent`** — Opt-in per-agent decomposer + aggregator that fans a single turn into N independent sub-tasks running in parallel. See "Mini-agents" below.

#### `agents.<name>.rag`

| Field | Type | Default |
|-------|------|---------|
| `namespace` | `string` | `""` |
| `k` | `number` | `5` |
| `enabled` | `boolean` | `true` |
| `ragTtl` | `number` | `0` |
| `retrieval` | `object` | (from defaults) |

- **`namespace`** — The vector-store collection name where this agent's domain knowledge is stored (e.g. `"flights"`, `"hotels"`, `"knowledge_base"`). Each namespace is a separate collection. Multiple agents can share a namespace, or each can have its own. Leave empty (`""`) if the agent doesn't use RAG retrieval.
- **`k`** — Maximum number of documents retrieved per query for this agent. Overrides `defaults.rag.k`.
- **`enabled`** — Whether this agent queries the vector store. When `false`, RAG retrieval and dynamic injection are skipped entirely. Override `defaults.rag.enabled` for agents that don't need vector search.
- **`ragTtl`** — Cache TTL (seconds) for tool results injected into RAG by this agent. Overrides `defaults.rag.ragTtl`. `0` = always call tools fresh.
- **`retrieval`** — Per-agent retrieval config (strategy + transformers + transformer prompts) overriding `defaults.rag.retrieval`.

#### `agents.<name>.executionHints`

| Field | Type | Default |
|-------|------|---------|
| `parallelSafe` | `boolean` | `true` |

- **`parallelSafe`** — Tells the supervisor whether this agent can run concurrently with other agents. When `true` (default), the supervisor may invoke multiple agents in parallel for a single query. When `false`, the supervisor runs this agent sequentially. Set to `false` when the agent depends on results from other agents, has side effects, or when tool execution order matters.

#### `agents.<name>.mcpServers[]`

| Field | Type | Default |
|-------|------|---------|
| `name` | `string` | (required) |
| `type` | `"local"` / `"remote"` | `"local"` |
| `transport` | `"streamable_http"` / `"sse"` | `"streamable_http"` |
| `url` | `string` | (required) |
| `auth` | `object` | `{mode: "none"}` |
| `tools` | `list / "*"` | `[]` |
| `prompts` | `list / "*"` | `[]` |
| `resources` | `list / "*"` | `[]` |
| `toolCallStrategy` | `string` | `"all"` |

- **`name`** — Unique identifier for this MCP server within the agent. Used in logging, error messages, and as a key when referencing the server in skill steps (`source: "airline-api"`).
- **`type`** — Whether the MCP server runs as a local process (`"local"`) or as a remote HTTP service (`"remote"`). Affects connection handling and error retry behavior.
- **`transport`** — The MCP transport protocol. `"streamable_http"` is the standard stateless protocol (recommended). `"sse"` uses Server-Sent Events for streaming responses. Most MCP servers use `streamable_http`.
- **`url`** — The MCP server's HTTP endpoint. Supports environment variable interpolation with `${VAR_NAME}` syntax (e.g. `"${AIRLINE_MCP_URL}"`). Variables are resolved from the environment at config load time.
- **`tools`** — Either an explicit list of `ToolConfig` objects (specifying which tools to use from this server) or the wildcard `"*"` to auto-discover all tools at runtime. An explicit list acts as an allow-list: only listed tools are called. Use `"*"` for development/exploration; use explicit lists in production.
- **`prompts`** — Prompt template names to load from the MCP server, or `"*"` to load all.
- **`resources`** — Resource URIs to load from the MCP server, or `"*"` to load all.
- **`toolCallStrategy`** — Controls how multiple tools on this server are executed during **skill execution**:
  - `"all"` — Call every tool in the list simultaneously and collect all results.
  - `"sequential"` — Call tools one by one in order. Each tool receives the accumulated results from previous tools.
  - `"llm_decides"` — Ask the LLM to decide which tools to call and with what arguments.
- **`auth`** — Per-server authentication configuration (see `agents.<name>.mcpServers[].auth` below). Defaults to `mode: "none"` (no auth headers).

> **Capability cache lifetime:** discovery results (`listTools()`, `listPrompts()`, `listResources()`) are cached for the lifetime of the process and warmed proactively at startup / session start by `OrchidSessionWarmer` — the per-request hot path stops paying the discovery cost. Flush stale capabilities via `OrchidMCPClient.invalidateCache()` (or a future admin endpoint).

> **Fault isolation:** MCP server communication boundaries use broad exception handling. If a server returns HTTP errors (401 Unauthorized, 500 Internal Server Error), connection failures, or protocol errors, the agent logs a warning and continues with the remaining servers and tools — it does not crash or retry endlessly. This applies to tool execution (strategies), capability discovery (`renderCapabilities`), and the `fetch()` dispatcher. One failing MCP server never takes down the entire agent.

#### `agents.<name>.mcpServers[].tools[]`

| Field | Type | Default |
|-------|------|---------|
| `name` | `string` | (required) |
| `arguments` | `record` | `{}` |
| `injectToRag` | `boolean` | `false` |
| `ragTtl` | `number \| null` | `null` |
| `parallelSafe` | `boolean` | `false` |
| `requiresApproval` | `boolean` | `false` |

- **`name`** — The exact tool name as registered on the MCP server. Must match what the server reports via `listTools()`.
- **`arguments`** — Default arguments passed to this tool on every invocation. The agent can't override these at runtime — they're baked into the config.
- **`injectToRag`** — When `true`, the tool's return value is stored as a document in the vector store after execution. Enables the RAG cache.
- **`ragTtl`** — Per-tool override for the cache TTL (seconds). When `null`, uses the agent's `rag.ragTtl`.
- **`parallelSafe`** — Per-tool override for parallel dispatch. When `true`, this tool can run concurrently with other `parallelSafe` tools in the same agentic round. See "Parallel tool dispatch" below.
- **`requiresApproval`** — When `true`, the tool pauses the graph and returns a `GraphInterrupt` that the API/CLI surfaces to the user. Resume via `Orchid.resume(threadId, { tool, args, agent, approved })`.

#### `agents.<name>.mcpServers[].auth` (MCP Auth)

| Field | Type | Default |
|-------|------|---------|
| `mode` | `"none"` / `"passthrough"` / `"oauth"` | `"none"` |

YAML carries ONLY the auth mode. Nothing else — no `clientId`, no
`clientSecret`, no endpoints — needs to live in configuration.

- **`mode`** — How the MCP client authenticates with this server:
  - `"none"` (default) — No authentication headers. Use for local MCP servers or remote servers without auth.
  - `"passthrough"` — Forwards the graph's `OrchidAuthContext` bearer token unchanged. Use when the MCP server trusts the same identity provider as the main application.
  - `"oauth"` — Per-user OAuth 2.0 flow with the MCP server's authorization server. The framework follows the **MCP 2025-03-26 authorization spec**: on the first 401 it consumes the `WWW-Authenticate: Bearer resource_metadata="…"` header (RFC 9728), fetches the authorization server metadata (RFC 8414), dynamically registers a client (RFC 7591), and persists the resulting endpoints + credentials to `OrchidMCPClientRegistrationStore`. Per-user tokens land in `OrchidMCPTokenStore` and are refreshed against the discovered token endpoint automatically.

The authorization server MUST advertise `registration_endpoint` in its
RFC 8414 metadata. If it doesn't, discovery fails with a clear error —
integrators whose IdP lacks DCR should seed `OrchidMCPClientRegistrationStore`
manually with the relevant endpoints + client credentials before first use.

Example:

```yaml
mcpServers:
  # No auth (default) — local MCP server
  - name: local-tools
    url: http://localhost:3001/mcp
    tools: "*"

  # Passthrough — forwards the platform bearer token
  - name: internal-api
    url: ${INTERNAL_MCP_URL}
    tools: "*"
    auth:
      mode: passthrough

  # OAuth — everything discovered at runtime from the MCP server's 401
  - name: external-crm
    url: ${CRM_MCP_URL}
    tools: "*"
    auth:
      mode: oauth
```

#### `agents.<name>.skills.<name>` (Agent Skills)

| Field | Type | Default |
|-------|------|---------|
| `description` | `string` | `""` |
| `steps` | `list` | (required) |

- **`description`** — Description of what this skill does. The agent's `SkillDetector` uses an LLM to match the user's query against available skill descriptions. If a match is found, the skill runs instead of the normal tool-calling pipeline.
- **`steps`** — Ordered list of steps. Each step is either a tool call or an agent invocation (exactly one of `tool` or `agent` must be set). Steps execute sequentially, and each step receives the accumulated results from all previous steps.

Each step:

| Field | Type |
|-------|------|
| `tool` | `string` |
| `source` | `string` |
| `arguments` | `record` |
| `agent` | `string` |
| `instruction` | `string` |

- **`tool`** — Name of the tool to call (MCP tool name or built-in tool name). Mutually exclusive with `agent`.
- **`source`** — Where to find the tool. Set to an MCP server `name` (e.g. `"airline-api"`) for MCP tools, or `"builtin"` for built-in tools. When `null` or omitted, defaults to `"builtin"`.
- **`arguments`** — Extra arguments passed to the tool for this specific step. Merged with the tool's default arguments from the server config.
- **`agent`** — Name of another agent to invoke directly (bypasses the supervisor). The invoked agent runs its full pipeline (RAG + tools + LLM) and its result chains forward to the next step. Mutually exclusive with `tool`.
- **`instruction`** — Query or instruction sent to the invoked agent. Overrides the user's original message for this step.

#### `events` (Pollen + Bloom — optional, opt-in)

Top-level block that wires the event-driven activation layer. **Omit it (or set `events.enabled: false`) and nothing in `@orchid-ai/orchid/events/` runs** — no producers / processors are started, no DB rows are written, zero overhead.

| Field | Type | Default |
|-------|------|---------|
| `enabled` | `boolean` | `false` |
| `queue` | `object` | `null` (recommended when `enabled: true`) |
| `processors` | `list` | `[]` |
| `validators` | `list` | `[]` |
| `triggers` | `list` | `[]` |
| `schedules` | `list` | `[]` |
| `ingestion` | `object` | `null` |

> **TS port note:** the TypeScript port ships an in-memory event substrate
> out of the box (`InMemorySignalStore`, `InMemorySignalQueue`,
> `InMemoryJobStore`, …) and a cron-based scheduler (`CronScheduler`).
> The full plugin/queue/processor surface from the Python port is wired
> at the same ABCs (`core/events/*`); concrete Postgres / relay
> implementations land in `@orchid-ai/storage-postgres` and consumer
> projects, mirroring the Python plugin layout.

- **`enabled`** — Master switch. The full block is still parsed when `false` so typos in your YAML still fail loudly, but no runtime objects are constructed. Default `false` is the zero-overhead opt-out.
- **`queue`** — Durable signal buffer config: `backend` (`"memory"` default, or a registered backend class), `dsn` (nullable), `visibilityTimeoutSeconds` (default `30`), `maxReceiveCount` (default `3`), `leasePollIntervalMs` (default `1000`).
- **`processors`** — Drain the queue and run the matched Blooms. Each: `type` (string), `config` (record), `identity` (discriminated union — see below), `ingestion` (optional nested config).
- **`validators`** — Auth validators for incoming HTTP webhook signals. Built-ins: `BearerEventAuth`, `HMACEventAuth`. Each: `type` (string), `config` (record).
- **`triggers`** — Signal → action rules. Each: `signal` (optional), `predicate` (optional), `match` (`{signalSource?, payloadKey?}`), `action` (required), `emits` (list of `{signal, payload}`), `retry` (optional — see below), `config` (record).
- **`schedules`** — Cron-based schedules that emit signals. Each: `expression` (cron string), `timezone` (default `"UTC"`), `signal` (name), `payload` (record), `enabled` (default `true`).
- **`ingestion`** — Optional webhook ingestion config: `sources` (file-system / local ingestion entries), `vectorBackend`, `namespace`, `embeddingModel`.

##### `events.triggers[].identity` — discriminated union

The `identity` on a processor (or trigger emit) controls *who* the Bloom runs as.

| `type` | Extra fields | Behaviour |
|--------|-------------|-----------|
| `service_account` | `name: string` | The processor calls `OrchidIdentityResolver.resolveServiceAccount(name)`. The platform acts under a named service identity (e.g. a `digest-bot`). No user-of-record. |
| `addressed_to` | `userId: string` | Same service identity, but the resulting auth context is *tagged* with a `userId`. Used for user-scoped RAG / chat binding without impersonation. |
| `act_as` | `userId: string` | Full user impersonation. The processor calls `OrchidIdentityResolver.mintForUser(tenantKey, userId)`. |

##### `events.triggers[].retry`

| Field | Type | Default |
|-------|------|---------|
| `maxRetries` | `number` | `3` |
| `backoff` | `"fixed"` / `"exponential"` | `"exponential"` |
| `delaySeconds` | `number` | `60` |
| `maxDelaySeconds` | `number` | `3600` |

Per-trigger retry of the supervisor invocation (distinct from queue retry which is governed by `events.queue.maxReceiveCount`).

##### Cross-field validation

When `events.enabled: true`:

- `events.processors` must have at least one entry.
- Every Pydantic-equivalent zod model under the `events.*` namespace uses `passthrough()` selectively and rejects unknown enum values; typos in `type` fields surface as clear errors at registration time.

##### Worked example

```yaml
events:
  enabled: true

  queue:
    backend: memory
    visibilityTimeoutSeconds: 60
    maxReceiveCount: 5

  processors:
    - type: asyncio-worker-pool
      config:
        concurrency: 8
      identity:
        type: service_account
        name: digest-bot

  validators:
    - type: hmac
      config:
        secretRef: env:SUPPORT_HMAC_SECRET

  schedules:
    - id: morning-digest-cron
      expression: "0 7 * * 1-5"
      timezone: UTC
      signal: cron.morning-digest
      payload:
        tenantKey: default
      enabled: true

  triggers:
    # Cron-driven Bloom — a digest assembled by a service identity
    - id: morning-digest
      signal: cron.morning-digest
      action: run_agent
      config:
        agent: notifications
        promptTemplate: "Build the morning digest for {{tenantKey}}"
      retry:
        maxRetries: 3
        backoff: exponential
        delaySeconds: 5

    # Webhook-driven Bloom that posts back into the originating user's chat
    - id: support-ticket-triage
      signal: support.ticket.created
      predicate: "payload.priority == 'high'"
      action: run_agent
      config:
        agent: support
        promptTemplate: |
          A new high-priority ticket arrived: {{payload.subject}}.
          Draft an initial reply.
        respectChatBinding: true
      retry:
        maxRetries: 5
        backoff: exponential
```

---

### orchid.yml Reference

Runtime configuration consumed by `@orchid-ai/api` and `@orchid-ai/cli`. Each nested YAML key maps to a flat environment variable. **Priority:** env vars > `orchid.yml` > hardcoded defaults.

#### `agents`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `agents.configPath` | `AGENTS_CONFIG_PATH` | `"agents.yaml"` |

- **`agents.configPath`** — Path to the `agents.yaml` file (relative to working directory or absolute). This is the only required pointer between the two config files. `@orchid-ai/api` and `@orchid-ai/cli` read this to find agent definitions.

#### `llm`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `llm.model` | `LLM_MODEL` | `"ollama/llama3.2"` |
| `llm.ollamaApiBase` | `OLLAMA_API_BASE` | |
| `llm.groqApiKey` | `GROQ_API_KEY` | `""` |
| `llm.geminiApiKey` | `GEMINI_API_KEY` | `""` |
| `llm.anthropicApiKey` | `ANTHROPIC_API_KEY` | `""` |
| `llm.openaiApiKey` | `OPENAI_API_KEY` | `""` |

- **`llm.model`** — Default LLM model for the API/CLI runtime. The graph builder uses it as the fallback model when an agent doesn't specify one in `agents.yaml`. Uses the `provider/model-name` format.
- **`llm.ollamaApiBase`** — Base URL for the Ollama server when using `ollama/*` models. Defaults to `http://localhost:11434` if not set. In Docker, typically `http://host.docker.internal:11434` to reach the host's Ollama instance.
- **`llm.groqApiKey`** — API key for Groq cloud inference. Required when using `groq/*` models.
- **`llm.geminiApiKey`** — API key for Google Gemini models. Required when using `gemini/*` models. Also used for Gemini embedding models in the RAG section.
- **`llm.anthropicApiKey`** — API key for Anthropic Claude models. Required when using `anthropic/*` models.
- **`llm.openaiApiKey`** — API key for OpenAI models. Required when using `openai/*` models. Also used for OpenAI embedding models (`text-embedding-3-small`).

#### `auth`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `auth.devBypass` | `DEV_AUTH_BYPASS` | `false` |
| `auth.identityResolverClass` | `IDENTITY_RESOLVER_CLASS` | `""` |
| `auth.domain` | `AUTH_DOMAIN` | `""` |

- **`auth.devBypass`** — When `true`, the API skips Bearer token validation and uses a dummy `OrchidAuthContext` with tenant `"99999"` and user `"dev-user-00000000"`. All requests are allowed without authentication. **Never enable in production.** Useful for local development and testing without an OAuth provider.
- **`auth.identityResolverClass`** — Dotted import path to a custom `OrchidIdentityResolver` subclass (e.g. `"myapp.identity.MyIdentityResolver"`). The resolver receives the Bearer token from the `Authorization` header and returns an `OrchidAuthContext` with tenant/user information. When empty, only `devBypass` works — all other requests get a 503.
- **`auth.domain`** — Default platform domain passed to the identity resolver when the `x-auth-domain` header is missing from the request.

> **CLI OAuth support:** `@orchid-ai/cli` extends the `auth` section with an `auth.cli` subsection for OAuth 2.0 Authorization Code + PKCE login. This is a CLI-only feature — the API uses its own Fastify dependency injection for auth. See the `@orchid-ai/cli` README for details.

#### `startup`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `startup.hook` | `STARTUP_HOOK` | `""` |

- **`startup.hook`** — Dotted import path to an async function called once during server startup, after the graph is built and storage is initialized. The function receives `reader` and `settings` as keyword arguments. Use it for one-time setup tasks like seeding the vector store, pre-loading data, or registering webhooks. Example: `"myapp.startup.seedData"`.

#### `rag`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `rag.vectorBackend` | `VECTOR_BACKEND` | `"qdrant"` |
| `rag.qdrantUrl` | `QDRANT_URL` | `"http://qdrant:6333"` |
| `rag.embeddingModel` | `EMBEDDING_MODEL` | `"text-embedding-3-small"` |
| `rag.openaiApiKey` | `OPENAI_API_KEY` | `""` |
| `rag.geminiApiKey` | `GEMINI_API_KEY` | `""` |

- **`rag.vectorBackend`** — Which vector store backend to use. `"qdrant"` connects to a Qdrant server for full vector search and storage. `"null"` uses a no-op backend that returns empty results. `"chroma"` and `"neo4j"` are also supported via their respective plugins.
- **`rag.qdrantUrl`** — HTTP URL of the Qdrant server. Collections are auto-created at startup for all namespaces declared in `agents.yaml`.
- **`rag.embeddingModel`** — The model used to convert text into vectors for storage and retrieval. Must match the dimensionality of existing collections. **Switching models requires wiping and re-indexing all collections** because different models produce different-sized vectors.
- **`rag.openaiApiKey`** — API key for OpenAI embedding models. Required when `embeddingModel` is an OpenAI model.
- **`rag.geminiApiKey`** — API key for Gemini embedding models. Required when `embeddingModel` is a Gemini model.

#### `upload`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `upload.visionModel` | `VISION_MODEL` | `""` |
| `upload.namespace` | `UPLOAD_NAMESPACE` | `"uploads"` |
| `upload.maxSizeMb` | `UPLOAD_MAX_SIZE_MB` | `20` |
| `upload.chunkSize` | `CHUNK_SIZE` | `1000` |
| `upload.chunkOverlap` | `CHUNK_OVERLAP` | `200` |

- **`upload.visionModel`** — LLM model used to extract text from images and scanned documents via visual understanding. When empty, the primary `llm.model` is used as fallback. Set this to a vision-capable model (e.g. `"ollama/minicpm-v"`, `"openai/gpt-4o"`).
- **`upload.namespace`** — Vector-store collection name where uploaded document chunks are stored. Defaults to `"uploads"`. All agents can access uploaded documents via the `"uploads"` namespace in their RAG retrieval.
- **`upload.maxSizeMb`** — Maximum allowed file upload size in megabytes. Requests with files larger than this are rejected with a 413 error.
- **`upload.chunkSize`** — Target size (in tokens) for each text chunk when splitting uploaded documents. Default 1000.
- **`upload.chunkOverlap`** — Number of overlapping tokens between consecutive chunks. Default 200.

#### `storage`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `storage.class` | `CHAT_STORAGE_CLASS` | `"@orchid-ai/orchid/persistence#OrchidSQLiteChatStorage"` |
| `storage.dsn` | `CHAT_DB_DSN` | `"~/.orchid/chats.db"` |

- **`storage.class`** — Dotted import path (with `#ExportName` suffix) to the `OrchidChatStorage` implementation. The class is dynamically imported at startup. Built-in options:
  - `@orchid-ai/orchid/persistence#OrchidSQLiteChatStorage` — Default. Stores chats in a local SQLite file via `better-sqlite3`. Zero config, no external database needed.
  - `@orchid-ai/storage-postgres#OrchidPostgresChatStorage` — PostgreSQL backend. Requires `npm install @orchid-ai/storage-postgres` and a running PostgreSQL instance.
  - Custom backends: implement the `OrchidChatStorage` interface and reference your class here.
- **`storage.dsn`** — Database connection string. For SQLite: a file path. The directory is created automatically. For PostgreSQL: a full DSN (e.g. `"postgresql://user:pass@localhost:5432/orchid"`).

#### `tracing`

| YAML Key | Env Var | Default |
|----------|---------|---------|
| `tracing.langsmithTracing` | `LANGSMITH_TRACING` | `false` |
| `tracing.langsmithApiKey` | `LANGSMITH_API_KEY` | `""` |
| `tracing.langsmithProject` | `LANGSMITH_PROJECT` | `"agents"` |

- **`tracing.langsmithTracing`** — Enable LangSmith tracing for observability. When `true`, all LangGraph executions (agent runs, tool calls, LLM completions) are logged to LangSmith for debugging and analysis. Default `false` to avoid unintended data transmission.
- **`tracing.langsmithApiKey`** — Your LangSmith API key. Required when `langsmithTracing` is `true`.
- **`tracing.langsmithProject`** — LangSmith project name where traces are grouped. Default `"agents"`.

---

### Complete Example (All Parameters)

**agents.yaml** — every available parameter:

```yaml
version: "1"

# ── Defaults (inherited by all agents) ───────────────────────
defaults:
  llm:
    model: "gemini/gemini-2.5-flash"
    temperature: 0.2
  rag:
    k: 5
    enabled: true
    ragTtl: 3600                    # 1 hour default cache for tool results
    retrieval:
      strategy: hybrid
      transformers: [reformulate]

# ── Supervisor ───────────────────────────────────────────────
supervisor:
  assistantName: "Travel Assistant"
  routingSystemPrompt: |
    You are the routing brain. Analyze the user's message and decide
    which agent(s) should handle it. Consider agent descriptions carefully.
  synthesisSystemPrompt: |
    You are the synthesis layer. Combine results from all agents into
    a single, coherent response for the user.
  sequentialAdvancePrompt: |
    The previous agent has completed its step. Based on its output,
    decide whether to advance to the next step or respond directly.

# ── Global guardrails ────────────────────────────────────────
guardrails:
  input:
    - type: promptInjection
      failAction: block
    - type: contentSafety
      failAction: block
    - type: maxLength
      failAction: block
      config:
        maxCharacters: 10000
  output:
    - type: piiDetection
      failAction: redact
      config:
        entities: [email, phone, ssn, creditCard]

# ── Global built-in tools ────────────────────────────────────
tools:
  formatDate:
    handler: "myapp/tools/dates/formatDate.js"
    description: "Format a date string into a specified format"
    injectToRag: false             # results NOT cached (default)
    ragTtl: null                    # use agent default (default)
    parameters:                     # required in the TS port
      value:
        type: string
        description: "Date string to parse (ISO-8601 or common formats)"
        required: true
      fmt:
        type: string
        description: "Output format using strftime pattern"
        required: false
        default: "%Y-%m-%d"

  getExchangeRate:
    handler: "myapp/tools/finance/getExchangeRate.js"
    description: "Get current exchange rate between two currencies"
    injectToRag: true               # results cached in RAG
    ragTtl: 600                     # override: 10 min (rates change often)
    parameters:
      fromCurrency:
        type: string
        description: "Source currency code (e.g. USD, EUR)"
        required: true
      toCurrency:
        type: string
        description: "Target currency code (e.g. GBP, JPY)"
        required: true

  calculateBudget:
    class: "myapp/tools/finance/CalculateBudgetTool.js#CalculateBudgetTool"
    description: "Calculate travel budget from itemized costs"
    injectToRag: true               # results cached
    ragTtl: null                    # use agent default (3600s from defaults)

# ── Orchestrator-level skills (cross-agent) ──────────────────
skills:
  tripPlanner:
    description: >
      Plan a complete trip: find flights, book hotels,
      and suggest activities at the destination.
    steps:
      - agent: flights
        instruction: "Search for flights to the destination on the requested dates"
      - agent: hotels
        instruction: "Based on the flight results, find hotels near the airport for those dates"
      - agent: activities
        instruction: "Suggest activities and restaurants at the destination for the trip duration"

  budgetReview:
    description: >
      Review all booked items and produce a complete budget breakdown.
    steps:
      - agent: flights
        instruction: "Get the price summary for the booked flights"
      - agent: hotels
        instruction: "Get the price summary for the booked hotels"

# ── Agents ───────────────────────────────────────────────────
agents:

  # ── Agent with MCP servers + all MCP options ───────────────
  flights:
    description: >
      Flight search and booking agent. Searches airlines,
      compares prices, and can hold reservations.
    prompt: |
      You are a Flight Search Agent.
      Use the available tools to find and compare flights.
      Always present options sorted by price.
      Include airline, departure/arrival times, and layovers.

    # Per-agent LLM override
    llm:
      model: "openai/gpt-4o"
      temperature: 0.1

    # Per-agent RAG settings
    rag:
      namespace: flights
      k: 10                          # retrieve more results for flights
      enabled: true
      ragTtl: 7200                   # 2 hour cache for this agent

    # MCP server connections
    mcpServers:
      # Server with explicit tool allow-list
      - name: airline-api
        type: remote
        transport: streamable_http
        url: "${AIRLINE_MCP_URL}"
        toolCallStrategy: sequential
        tools:
          - name: searchFlights
            arguments:
              currency: USD
            injectToRag: true        # cache search results
            ragTtl: 1800             # override: 30 min for flight searches
          - name: holdReservation
            injectToRag: false       # never cache booking actions
            requiresApproval: true   # pause graph for user approval
          - name: getSeatMap
            arguments:
              class: economy
            injectToRag: true        # cache seat maps
            ragTtl: null             # use agent ragTtl (7200s)
        prompts: []
        resources: []

      # Server with wildcard discovery (all tools + prompts)
      - name: price-tracker
        type: local
        transport: streamable_http
        url: "http://localhost:3002"
        toolCallStrategy: all
        tools: "*"                   # discover all tools at runtime
        prompts: "*"                 # discover all prompts at runtime
        resources: "*"               # discover all resources at runtime

    # Built-in tools available to this agent
    tools:
      - formatDate
      - getExchangeRate

    # Agent-level skills (multi-step workflows within this agent)
    skills:
      priceComparison:
        description: "Search multiple routes and compare prices side by side"
        steps:
          # Tool call step (MCP)
          - tool: searchFlights
            source: airline-api
            arguments:
              maxResults: 5
          # Tool call step (built-in)
          - tool: getExchangeRate
            source: builtin
          # Agent invocation step (calls another agent directly)
          - agent: hotels
            instruction: "Find hotels near the destination airport for the same dates"

    # Per-agent guardrails (in addition to global)
    guardrails:
      input:
        - type: topicRestriction
          failAction: warn
          config:
            allowedTopics: [flights, airlines, airports, travel, booking]

    executionHints:
      parallelSafe: true

  # ── Agent with custom class ────────────────────────────────
  hotels:
    description: >
      Hotel search agent. Finds accommodations, compares ratings,
      and checks availability.
    prompt: |
      You are a Hotel Search Agent.
      Find the best hotel options based on location, dates, and budget.
      Prioritize ratings and proximity to landmarks.

    # Custom agent class (overrides GenericAgent)
    class: "myapp/agents/hotels/HotelAgent.js#HotelAgent"

    rag:
      namespace: hotels
      k: 5
      enabled: true
      ragTtl: 3600

    mcpServers:
      - name: booking-api
        type: remote
        transport: sse              # SSE transport variant
        url: "${BOOKING_MCP_URL}"
        toolCallStrategy: llm_decides
        tools:
          - name: searchHotels
            injectToRag: true
          - name: checkAvailability
          - name: getReviews
            injectToRag: true
            ragTtl: 86400            # 24 hours for reviews (rarely change)
        prompts:
          - hotelSearchPrompt
          - reviewSummaryPrompt
        resources:
          - hotels://popular-destinations

    tools:
      - calculateBudget

    executionHints:
      parallelSafe: true

  # ── Minimal agent (inherits all defaults) ──────────────────
  activities:
    description: >
      Activities and restaurant suggestion agent.
      Recommends things to do at the destination.
    prompt: |
      You are an Activities Agent.
      Suggest popular activities, restaurants, and experiences.
      Consider weather, season, and user preferences.

    # No LLM override (uses defaults: gemini/gemini-2.5-flash, temp 0.2)
    # No RAG override (uses defaults: enabled=true, k=5, ragTtl=3600)
    # No MCP servers
    # No built-in tools
    # No skills

    rag:
      namespace: activities

    executionHints:
      parallelSafe: false            # must run after other agents
```

**orchid.yml** — every available parameter:

```yaml
# ── Agent config path ────────────────────────────────────────
agents:
  configPath: config/agents.yaml

# ── LLM providers ────────────────────────────────────────────
llm:
  model: gemini/gemini-2.5-flash
  ollamaApiBase: http://localhost:11434
  groqApiKey: "gsk_..."
  geminiApiKey: "AIza..."
  anthropicApiKey: "sk-ant-..."
  openaiApiKey: "sk-..."

# ── Authentication ───────────────────────────────────────────
auth:
  devBypass: false
  identityResolverClass: "myapp/identity/MyIdentityResolver.js#MyIdentityResolver"
  domain: "myapp.example.com"

# ── Startup hook ─────────────────────────────────────────────
startup:
  hook: "myapp/startup/onStartup.js#onStartup"

# ── RAG / Vector DB ──────────────────────────────────────────
rag:
  vectorBackend: qdrant
  qdrantUrl: http://localhost:6333
  embeddingModel: text-embedding-3-small
  openaiApiKey: "sk-..."
  geminiApiKey: "AIza..."

# ── Document upload ──────────────────────────────────────────
upload:
  visionModel: ollama/minicpm-v
  namespace: uploads
  maxSizeMb: 20
  chunkSize: 1000
  chunkOverlap: 200

# ── Chat persistence ─────────────────────────────────────────
storage:
  class: "@orchid-ai/storage-postgres#OrchidPostgresChatStorage"
  dsn: postgresql://user:pass@localhost:5432/orchid

# ── Observability ────────────────────────────────────────────
tracing:
  langsmithTracing: true
  langsmithApiKey: "lsv2_..."
  langsmithProject: "my-project"
```

## Guardrails

Orchid includes a 3-tier guardrail system that firewalls both the orchestrator and individual agents. Guardrails are configured entirely in YAML — no code changes needed.

### Architecture

```
User message
  → Global input guardrails (prompt injection, content safety, max length, PII)
    → Supervisor routing
      → Per-agent input guardrails (topic restriction)
        → Agent execution
      → Per-agent output guardrails
    → Supervisor synthesis
  → Global output guardrails (PII redaction, groundedness)
→ Response
```

- **Global input guardrails** run on every user message before the supervisor sees it
- **Per-agent guardrails** run only when that specific agent is active
- **Global output guardrails** run on the final synthesized response

### Configuration

```yaml
# Global guardrails (apply to all agents)
guardrails:
  input:
    - type: promptInjection
      failAction: block
    - type: contentSafety
      failAction: block
    - type: maxLength
      failAction: block
      config:
        maxCharacters: 10000
    - type: piiDetection
      failAction: redact
      config:
        entities: [creditCard, ssn]
  output:
    - type: piiDetection
      failAction: redact
      config:
        entities: [email, phone, ssn, creditCard]

agents:
  basketball:
    description: "Basketball expert"
    prompt: "You are a basketball analyst."
    # Per-agent guardrails (in addition to global)
    guardrails:
      input:
        - type: topicRestriction
          failAction: warn
          config:
            allowedTopics: [basketball, NBA, players, teams, stats]
```

### Built-in Guardrail Types

| Type | Purpose | Default Action |
|------|---------|---------------|
| `promptInjection` | Detect instruction overrides, persona hijacks, delimiter injection | `block` |
| `contentSafety` | Block harmful content (violence, self-harm, illegal activity) | `block` |
| `piiDetection` | Detect/redact emails, phones, credit cards, SSNs, IPs | `redact` |
| `maxLength` | Reject messages exceeding a character limit | `block` |
| `topicRestriction` | Enforce per-agent domain boundaries via keyword matching | `warn` |
| `groundedness` | Check response grounding against RAG context | `warn` |

### Guardrail Actions

| Action | Behavior |
|--------|----------|
| `block` | Reject the message entirely; short-circuits the chain |
| `redact` | Replace matched content with `[REDACTED_<TYPE>]` placeholders; continues processing |
| `warn` | Allow the message but flag it in metadata |
| `log` | Silently log the detection; no user-visible effect |

### Custom Guardrails

Register custom guardrails by subclassing `OrchidGuardrail` and registering
the constructor with `registerGuardrail()`:

```ts
import {
  OrchidGuardrail,
  OrchidGuardrailAction,
  OrchidGuardrailResult,
  type OrchidGuardrailContext,
} from "@orchid-ai/orchid/core";
import { registerGuardrail } from "@orchid-ai/orchid/guardrails";

class MyCustomGuardrail extends OrchidGuardrail {
  private readonly failAction: OrchidGuardrailAction;

  constructor(opts?: { failAction?: string }) {
    super();
    this.failAction =
      (opts?.failAction?.toUpperCase() as OrchidGuardrailAction) ??
      OrchidGuardrailAction.BLOCK;
  }

  get name(): string {
    return "my_custom";
  }

  override async check(
    content: string,
    _context: OrchidGuardrailContext,
  ): Promise<OrchidGuardrailResult> {
    if (content.toLowerCase().includes("forbidden")) {
      return new OrchidGuardrailResult({
        triggered: true,
        action: this.failAction,
        guardrailName: this.name,
        message: "Forbidden content detected.",
      });
    }
    return OrchidGuardrailResult.passed(this.name);
  }
}

registerGuardrail("my_custom", MyCustomGuardrail);
```

Then use it in YAML:

```yaml
guardrails:
  input:
    - type: my_custom
      failAction: block
```

## RAG Hierarchy

```
"__shared__"                 All tenants
  tenantKey                  All users in tenant
    userId                    All user's chats
      chatId
        scope="chat_shared"   All agents in chat
        scope="chat_agent"    Agent-private
```

Always use `OrchidRAGScope` (`makeScope()`) — never raw `tenantId` filters.

## Advanced features

### Mini-agents (parallel sub-task fork)

Opt-in per-agent block that turns a single supervisor turn into N
independent sub-tasks running in parallel through copies of the
parent agent.  Best for tool-heavy questions that decompose cleanly
("compare A and B and look up C") — the LangGraph builder synthesises
three nodes per opt-in agent (`{name}_agent`, `{name}_mini`,
`{name}_aggregator`) and the conditional edge fans out via `Send`.

```yaml
agents:
  research:
    description: "Multi-faceted research agent."
    prompt: "..."
    miniAgent:
      enabled: true                      # default: false
      maxCount: 4                        # 2..8 (TS port: hard cap 8, default 3)
      timeoutSeconds: 60                 # per-mini wall clock
      toolAllowlistMode: strict          # strict | parent_full | inferred
      decomposerModel: gemini/gemini-flash-lite   # cheaper LLM for the splitter
      streamInnerTokens: false           # surface only mini_agent.* events by default
      decomposerPrompt: |                # optional — overrides the default
        ...
      aggregatorPrompt: |
        ...
      systemPromptTemplate: |            # optional — placeholders {parentPrompt}, {instruction}, {toolList}
        {parentPrompt}

        === SUB-TASK ===
        {instruction}

        === TOOLS ===
        {toolList}
```

Streaming consumers see `mini_agent.{decomposed,started,finished,aggregated}`
events.  Nesting is forbidden: child agents cannot enable
`miniAgent.enabled` (validation rejects it at config load).

### Parallel tool dispatch (`parallelTools`)

Intra-round parallel dispatch.  When `parallelTools: true`,
the agentic loop partitions one round's tool calls into:

- A **parallel batch** gathered via `Promise.all` — tools whose
  per-name `parallelSafe` is true.
- A **sequential tail** for everything else (HITL approvals, write
  effects, unknown safety).

`parallelSafe` resolves with this precedence (highest → lowest):

1. `requiresApproval: true` → never parallel.
2. Built-in tool → `true` iff its top-level `tools.<name>.parallelSafe: true`.
3. MCP tool with explicit YAML `parallelSafe` → use it.
4. MCP tool without override → `true` iff the server advertised
   `readOnlyHint=true`.

Default `false` preserves today's serial behaviour.

### Internal prompt customisation

Every LLM-facing internal prompt is YAML-configurable with
backwards-compatible defaults.  Six surfaces exist; pick the
ones relevant to your deployment.

```yaml
# Top-level supervisor prompts.
supervisor:
  assistantName: "Acme Knowledge Desk"
  routingSystemPrompt: |
    You coordinate the Acme Knowledge Desk's specialist agents...
  synthesisSystemPrompt: |
    You merge the specialists' outputs into a single answer...
  sequentialAdvancePrompt: |
    Hand off to the next specialist with a one-line summary of the prior step.
  historySummaryEnabled: true       # sliding-window compression
  historySummaryRecentTurns: 10

# Default RAG transformer prompts (inherited by all agents).
defaults:
  rag:
    retrieval:
      transformerPrompts:
        reformulate: |
          You rewrite ambiguous follow-ups into standalone search queries...

# Per-agent overrides — inherit from defaults; override granularly.
agents:
  legalAdvisor:
    prompt: "..."
    promptSections:
      priorResultsHeader: "\n=== COUNSEL'S NOTES ==="
      mcpPromptTemplate: "\n[authority {name}]\n{text}"
      ragHeader: "\n=== SOURCE CITATIONS ==="
      resourceMaxChars: 4000
      summariseHistoryReminder: "\n\nFOCUS ON THE LATEST QUESTION."
      summariseUserTemplate: "Question: {query}\n\n{ragSection}Live data:\n{mcpData}"
    rag:
      retrieval:
        strategy: hyde
        transformerPrompts:
          hyde:
            single: "Write one paragraph of plausible legal reasoning..."
            multi: "Write {n} legal-treatise paragraphs..."
          decompose: "Split into {n} legal sub-issues..."
```

Programmatic equivalents are exposed at:

- `OrchidAgentPromptConfig` (agentic-loop section templates + summarise overrides)
- `OrchidQueryTransformerPromptsConfig` (per-transformer prompts)
- `OrchidMiniAgentConfig.systemPromptTemplate` (per-mini focused prompt)
- `OrchidSupervisorConfig.routingSystemPrompt` etc.

### Custom retrieval strategies

`OrchidRetrievalStrategy` is a stateless abstract class with a `name`
getter and a `retrieve()` method. Subclass it, register at startup, then
reference by name in YAML.

```ts
// my_pkg/strategies/recency.ts
import {
  OrchidRetrievalStrategy,
} from "@orchid-ai/orchid/core";
import type {
  OrchidRAGScope,
  OrchidSearchResult,
  OrchidVectorReader,
} from "@orchid-ai/orchid/core";

export class RecencyRetrieval extends OrchidRetrievalStrategy {
  constructor(private readonly field = "publishedAt") {
    super();
  }

  get name(): string {
    return "recency";
  }

  override async retrieve(
    query: string,
    scope: OrchidRAGScope,
    reader: OrchidVectorReader,
    namespace: string,
    k = 5,
  ): Promise<OrchidSearchResult[]> {
    const results = await reader.retrieve(query, namespace, k * 2, scope);
    results.sort(
      (a, b) =>
        Number(b.document.metadata?.[this.field] ?? 0) -
        Number(a.document.metadata?.[this.field] ?? 0),
    );
    return results.slice(0, k);
  }
}
```

```yaml
# orchid.yml — register at startup
# startup:
#   hook: my_pkg/strategies/startup.js#registerStrategies
```

Built-in strategies live under
`@orchid-ai/orchid/rag/strategies/{simple,multiQuery,hyde,hybrid,graphRag}.js`
— short, readable templates for your own.

### Custom tool-call strategies

`OrchidToolCallStrategy` controls how an MCP server's tools are
dispatched during **skill execution**.  Built-ins: `all`,
`sequential`, `llm_decides`.  Register custom strategies via
`registerStrategy()` from a startup hook.

```ts
import type { OrchidToolCallStrategy } from "@orchid-ai/orchid/agents";
import type {
  OrchidAuthContext,
  OrchidMCPToolCaller,
  OrchidToolConfig,
} from "@orchid-ai/orchid/core";

export class PriorityStrategy implements OrchidToolCallStrategy {
  /** Try tools in order; stop at the first non-empty result. */
  async execute(
    client: OrchidMCPToolCaller,
    tools: OrchidToolConfig[],
    query: string,
    auth: OrchidAuthContext,
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};
    for (const tool of tools) {
      try {
        const r = await client.callTool(
          tool.name,
          { query, ...tool.arguments },
          auth,
        );
        results[tool.name] = r.text;
        if (r.text?.trim()) break;
      } catch (exc) {
        results[`${tool.name}_error`] = String(exc);
      }
    }
    return results;
  }
}

// Register once at startup (e.g. from a startup hook):
// import { registerStrategy } from "@orchid-ai/orchid/agents";
// registerStrategy("priority", PriorityStrategy);
```

```yaml
# Reference by name in agents.yaml
agents:
  cascadeLookup:
    mcpServers:
      - name: kb
        url: ${KB_MCP_URL}
        toolCallStrategy: priority
        tools:
          - { name: cacheLookup }
          - { name: primaryLookup }
          - { name: slowLookup }
```

Note: `toolCallStrategy` only fires inside skill-execution paths.
The default agentic loop (LLM picks tools via `tool_calls`) is always
"LLM decides".

### Custom storage backends

Implement `OrchidChatStorage` and reference its dotted import path
in `orchid.yml`.  Constructor must accept `dsn=` and
`extraMigrationsPackage=` (the framework factory passes both
unconditionally).

```yaml
storage:
  class: "my_pkg/storage/redis.js#OrchidRedisChatStorage"
  dsn: redis://localhost:6379/0
```

The library ships SQLite (default) and PostgreSQL backends. Custom
backends live in consumer projects and follow the same `dsn=…` +
`extraMigrationsPackage=…` constructor contract.

### Sliding-window history summarisation

For long-running chats the supervisor's history budget can blow past
the LLM's context window.  Opt in via
`supervisor.historySummaryEnabled: true` and the framework keeps
the most recent `historySummaryRecentTurns` (default 10) verbatim
while summarising older exchanges via a cheaper LLM
(`historySummaryModel`, defaults to the supervisor model).
Compression runs only when the chat actually exceeds the recent-turn
threshold so short chats pay nothing.

### Pollen + Bloom (event-driven activation)

The `events:` YAML block (see [agents.yaml Reference → `events`](#events-pollen--bloom--optional-opt-in)) wires an opt-in async substrate that turns webhooks, cron schedules, and in-graph `emitSignal` calls into background LangGraph runs.

**Naming.** *Pollen* is the signal substrate (ingest → persist → enqueue). *Bloom* is the execution layer (dequeue → match trigger → run agent under a synthesised auth context). A `JobRun` is the unit of execution.

**The flow.**

```
   ┌──────────────┐  ingest  ┌────────────────────────┐    enqueue    ┌──────────────┐
   │ Producer     │ ───────▶ │ OrchidSignalDispatcher │ ────────────▶ │ Signal Queue │
   │ (HTTP/cron/  │          │ (persist + enqueue,    │   (atomic     │ (durable     │
   │  internal)   │          │  one transaction)      │    outbox)    │  buffer)     │
   └──────────────┘          └────────────────────────┘               └──────┬───────┘
                                                                              │
                                                                  drain      ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ AsyncioWorkerPoolProcessor (or TS equivalent worker)                        │
   │   1. lease a Signal                                                         │
   │   2. resolve identity claim → OrchidAuthContext (via OrchidIdentityResolver)│
   │   3. find matching triggers (JMESPath ``when:`` evaluated here)             │
   │   4. insert a JobRun row, lock by parallelism_key, run GraphJobRunner       │
   │   5. on success / failure → emit BloomEvent stream events                   │
   └────────────────────────────────────────────────────────────────────────────┘
```

**Three identity flavours** for *who* the Bloom runs as (see `events.triggers[].identity` in the YAML reference):

- `service_account` — named platform identity (e.g. `digest-bot`), no user-of-record.
- `addressed_to` — service identity tagged with a `userId` extracted from the signal (user-scoped RAG without impersonation).
- `act_as` — full user impersonation via `OrchidIdentityResolver.mintForUser(tenantKey, userId)`. Probed at boot.

**Chat binding (opt-in).** A signal MAY carry a `ChatBinding {chatId, mode, onFailure, sourceMessageId?}`. When the matched trigger has `respectChatBinding: true` AND the resolved auth has write permission on the target chat, the run's final `AIMessage` is appended to that chat with `metadata.origin="bloom"`. Cross-user smuggling is rejected at run time regardless of what the signal carried — the runner re-validates ownership through the resolved auth. `OrchidAgent.emitSignal({ chatId: "self", … })` auto-fills `sourceMessageId` so the frontend can anchor an in-chat live-progress card under the user message that produced the binding.

**`OrchidAgent.emitSignal`** is the in-graph hook for fan-out: an agent emits a signal that a separate trigger picks up to run a different agent. Internal emissions go through `dispatcher.ingest` — there is **no** in-process fast path that bypasses persistence, so internal Blooms get the same idempotency, retries, and visibility filtering as webhook-driven ones.

**Idempotency by construction.** `UNIQUE (source, dedupeKey)` on signals; `UNIQUE (triggerId, signalId, attemptNumber)` on `job_runs`. Retries become new `JobRun` rows — never in-place updates.

**Streaming.** `BloomEventStream` is an in-process channel-keyed pub/sub (used by the `@orchid-ai/api` SSE endpoints):

- `run:{runId}` channel — operator-grade trace: `bloom.run.queued`, `bloom.run.started`, `bloom.run.finished`, plus tool / agent ticks.
- `chat:{chatId}` channel — chat-bound runs publish a redacted `ChatBloomEvent` stream: `chat.bloom.attached`, `chat.bloom.tick`, `chat.bloom.finished` (no raw tool result bodies, no run `result` payload — the final `AIMessage` flows through chat reload).

**Visibility.** `events.triggers[].emits.visibility` (and the resolved value carried on `JobSpec` / `JobRun`) drives a §26 visibility filter applied to every `SELECT FROM job_runs` / `signals` query in the API. Cross-tenant access is always rejected, even for admins. The reserved role string `OrchidAuthContext.roles = new Set(["admin"])` unlocks the `admin` visibility level.

**External buses.** `RelayingSignalQueue` is a publish-then-mark adapter: the dispatcher persists with `relayStatus=pending_publish`, the queue tries to publish to your `BusPublisher`, and `RelayRecoveryProducer` periodically sweeps pending rows so a transient publisher outage doesn't lose signals.

This whole layer is fully opt-in: omit `events:` (or set `events.enabled: false`) and zero new objects are constructed.

### MCP capability cache warming

The first agentic round normally needs an MCP `tools/list` /
`prompts/list` / `resources/list` round-trip per server.
`OrchidSessionWarmer` proactively populates the cache:

- `auth.mode: none` servers warm at process startup
  (`Orchid.warmUnauthenticatedCapabilities()`).
- `passthrough` and `oauth` servers warm at user-session start —
  the frontend calls `POST /session/warm` after login, with a
  fire-and-forget backstop on the first agentic loop.

Manual flush via `OrchidMCPClient.invalidateCache()` or
`OrchidSessionWarmer.invalidateUser(auth)`.

## Embedding Dimensions

| Model | Dimensions |
|-------|-----------|
| `ollama/nomic-embed-text` | 768 |
| `text-embedding-3-small` | 1536 |
| `gemini/gemini-embedding-001` | 3072 |

Switching models requires wiping and re-indexing the vector collections.

## MCP gateway exposure (optional)

`OrchidAgentsConfig` includes an **optional** `mcpGateway` field that
lets integrators customise how Orchid is presented to MCP clients via
the `@orchid-ai/mcp` gateway — tool title/description overrides + MCP
Prompt templates. The block is entirely optional — empty by default,
ignored when not populated.

```yaml
# agents.yaml
mcpGateway:
  tools:
    orchidAsk:
      title: "Ask the Acme Knowledge Base"
      description: "Route questions to the Acme support agents."
    # The Pollen + Bloom event tools (orchidSignalEmit /
    # orchidBloomStatus / orchidBloomList) override identically
    # — add an entry per tool the gateway exposes.
    orchidSignalEmit:
      title: "Trigger a background workflow"
      description: "Emit a Pollen signal to start an event-driven Bloom run."
  prompts:
    - name: complianceReport
      description: "Generate a compliance-completion report."
      arguments:
        - { name: department, required: true }
      template: |
        Produce a compliance report for {{department}}.
```

Exposed via `@orchid-ai/api`'s `GET /mcp-gateway/config` endpoint. Env-var
overrides (`ORCHID_MCP_GATEWAY_TOOL_*`, `ORCHID_MCP_GATEWAY_PROMPTS_FILE`)
live in `@orchid-ai/api`, not here.

## Markdown Configuration

Orchid supports three configuration modes:

- **All-YAML** (default): `orchid.yml` + `agents.yaml`
- **All-MD**: `orchid.md` + `agents/*.md`
- **Hybrid**: `orchid.yml` + `agents/*.md`

MD config uses YAML frontmatter for structured fields and the Markdown body for system prompts — no YAML block scalars, full syntax highlighting, and diff-friendly PR reviews. Each `agents/<name>.md` file becomes one agent.

```markdown
---
description: "Basketball expert"
tools:
  - getPlayerStats
  - comparePlayers
---

# Basketball Expert

You are a basketball statistics expert.
```

Auto-detection picks the right loader based on file extension and directory contents. An on-demand SHA-256 watcher detects changes and hot-reloads the graph without a restart.

```bash
# MD config
ORCHID_CONFIG=orchid.md npm start --workspace @orchid-ai/api

# Hybrid: YAML infra + MD agents
ORCHID_CONFIG=orchid.yml AGENTS_CONFIG_PATH=agents/ npm start --workspace @orchid-ai/api

# With hot-reload polling (default 30s)
ORCHID_RELOAD_INTERVAL=10 npm start --workspace @orchid-ai/api
```

## Testing

```bash
npm install
npm test                       # all tests via vitest
npm test -- scopes             # specific match
npm run lint                   # eslint
npm run typecheck              # tsc --noEmit
npm run format                 # prettier
```

## Code Style

- TypeScript 5.6+, ESLint 9 (`typescript-eslint`), Prettier
- Strict mode via `tsconfig.base.json`
- Naming: `camelCase` for variables/functions, `PascalCase` for types/classes, `kebab-case` for file names
- Imports: `from "@orchid-ai/orchid" or sub-paths` (never relative paths from outside the package)

## License

MIT — see [LICENSE](LICENSE).
