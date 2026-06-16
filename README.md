# @orchid-ai/orchid

Generic, platform-agnostic multi-agent AI framework. TypeScript port of `orchid-ai` (Python).

Built on **LangGraph.js**, with pluggable backends for vector search (Qdrant), persistence (SQLite/Postgres), MCP
servers, and LLM providers (OpenAI, Anthropic, Google, Ollama).

## Status

PoC port. The TypeScript surface mirrors the Python `orchid_ai` package 1:1 in semantics; idiomatic TypeScript shapes (
interfaces over ABCs, zod schemas over Pydantic) where appropriate.

## Architecture

The package is split into modules with strict layering:

```
src/
├── core/           Pure abstractions (zero external deps)
├── agents/         GenericAgent + collaborators
├── graph/          LangGraph wiring + supervisor
├── config/         YAML schema (zod) + loader
├── rag/            RAG: scopes, retrievers, transformers, backends
├── persistence/    ChatStorage interface + SQLite/Postgres
├── documents/      PDF/DOCX/XLSX/image parsing + chunking
├── mcp/            MCP client (Streamable HTTP) + OAuth
├── guardrails/     Output safety chain
├── llm/            Chat model factory + embeddings
└── observability/  Tracing + perf logging
```

## Critical rules (enforced)

1. `src/core/` has **zero** external dependencies. Only Node stdlib + zod (for type contracts).
2. No direct Qdrant imports outside `rag/backends/`.
3. MCP servers support three auth modes: `none`, `passthrough`, `oauth`.
4. RAG uses hierarchical 5-level scoping (`OrchidRAGScope`).
5. Chat persistence goes through `OrchidChatStorage` interface.

## Install

```bash
npm install @orchid-ai/orchid
```

Optional LLM providers (peer dependencies):

```bash
npm install @langchain/openai @langchain/anthropic @langchain/google-genai @langchain/ollama
```

## Quick start

```typescript
import { Orchid } from '@orchid-ai/orchid';

const orchid = await Orchid.fromConfigPath('./agents.yaml');

const result = await orchid.invoke({
  message: 'Hello',
  userId: 'user-123',
  tenantId: 'tenant-1',
  accessToken: 'bearer-token',
});

console.log(result.response);
await orchid.close();
```

See [orchid-examples](https://github.com/gadz82/orchid-examples) for full integrations.

## License

MIT
