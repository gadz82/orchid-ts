/** Entity extraction during ingestion. */

import type { OrchidEntity, OrchidEdge } from "../../core/graphStore.js";
import { OrchidEntityExtractor } from "../../core/graphStore.js";
import { OrchidChunkPostProcessor } from "../../core/ingestion.js";
import type { OrchidChunk } from "../../core/ingestion.js";

const _DEFAULT_EXTRACTION_PROMPT =
    "You extract structured entities and relationships from text.\n" +
    "RULES:\n" +
    '- Use stable lowercase ids prefixed with the entity type (e.g. "supplier:acme", "person:jane_doe").\n' +
    "- Every edge's source_id and target_id MUST appear in the entities list.\n" +
    "- Stick to the canonical relation labels in the schema when one fits; invent only when none of the canonical labels apply.\n" +
    "- Do NOT invent entities not grounded in the input text.";

export class LLMEntityExtractor extends OrchidEntityExtractor {
    private _systemPrompt: string;

    constructor(opts?: { systemPrompt?: string }) {
        super();
        this._systemPrompt = opts?.systemPrompt ?? _DEFAULT_EXTRACTION_PROMPT;
    }

    async extract(
        text: string,
        opts: { chatModel: unknown; schema?: Record<string, unknown> | null },
    ): Promise<{ entities: OrchidEntity[]; edges: OrchidEdge[] }> {
        const { chatModel, schema } = opts;

        if (chatModel == null || !text.trim()) {
            return { entities: [], edges: [] };
        }

        let prompt = this._systemPrompt;
        if (schema) {
            const constraints: string[] = [];
            const entityTypes = (schema.entity_types as string[]) || [];
            const relations = (schema.relations as string[]) || [];
            if (entityTypes.length > 0) {
                constraints.push(`Allowed entity types: ${entityTypes.join(", ")}.`);
            }
            if (relations.length > 0) {
                constraints.push(`Allowed relations: ${relations.join(", ")}.`);
            }
            if (constraints.length > 0) {
                prompt +=
                    "\n\nADDITIONAL CONSTRAINTS:\n" + constraints.map((c) => `- ${c}`).join("\n");
            }
        }

        try {
            const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");

            // Bind structured output schema
            const chatModelWithSchema = (chatModel as any).bind({
                response_format: { type: "json_object" },
            });

            const response = await (chatModelWithSchema as any).invoke([
                new SystemMessage(
                    prompt +
                        '\n\nRespond with a JSON object with "entities" (array of {id, type, name, properties}) and "edges" (array of {source_id, target_id, relation, properties}).',
                ),
                new HumanMessage(text),
            ]);

            const content =
                typeof response.content === "string"
                    ? response.content
                    : JSON.stringify(response.content);
            const parsed = JSON.parse(content) as {
                entities?: Array<{
                    id: string;
                    type: string;
                    name: string;
                    properties?: Record<string, unknown>;
                }>;
                edges?: Array<{
                    source_id: string;
                    target_id: string;
                    relation: string;
                    properties?: Record<string, unknown>;
                }>;
            };

            return this._validate(parsed);
        } catch {
            return { entities: [], edges: [] };
        }
    }

    private _validate(result: {
        entities?: Array<{
            id: string;
            type: string;
            name: string;
            properties?: Record<string, unknown>;
        }>;
        edges?: Array<{
            source_id: string;
            target_id: string;
            relation: string;
            properties?: Record<string, unknown>;
        }>;
    }): { entities: OrchidEntity[]; edges: OrchidEdge[] } {
        const entityIds = new Set((result.entities || []).map((e) => e.id));

        const entities: OrchidEntity[] = (result.entities || []).map((e) => ({
            id: e.id,
            type: e.type,
            name: e.name,
            properties: e.properties ?? {},
            metadata: {},
        }));

        const edges: OrchidEdge[] = [];
        for (const e of result.edges || []) {
            if (!entityIds.has(e.source_id) || !entityIds.has(e.target_id)) {
                continue;
            }
            edges.push({
                sourceId: e.source_id,
                targetId: e.target_id,
                relation: e.relation,
                properties: e.properties ?? {},
                metadata: {},
            });
        }

        return { entities, edges };
    }
}

export class EntityExtractionPostProcessor extends OrchidChunkPostProcessor {
    private _extractor: OrchidEntityExtractor;

    constructor(opts?: { extractor?: OrchidEntityExtractor }) {
        super();
        this._extractor = opts?.extractor ?? new LLMEntityExtractor();
    }

    async process(
        chunks: OrchidChunk[],
        opts: {
            text: string;
            filename: string;
            chatModel?: unknown;
            graphStore?: any;
            scope?: any;
            schema?: Record<string, unknown>;
        },
    ): Promise<OrchidChunk[]> {
        if (chunks.length === 0) return [];

        const { chatModel, graphStore, scope, schema } = opts;

        if (chatModel == null || graphStore == null || scope == null) {
            return chunks;
        }

        if (graphStore.isNull === true) {
            return chunks;
        }

        const out: OrchidChunk[] = [];
        for (const chunk of chunks) {
            const { entities, edges } = await this._extractor.extract(chunk.text, {
                chatModel,
                schema,
            });

            if (entities.length > 0) {
                await graphStore.upsertEntities(entities, scope);
            }
            if (edges.length > 0) {
                await graphStore.upsertEdges(edges, scope);
            }

            const mentioned = entities.map((e) => e.id).sort();
            out.push({
                text: chunk.text,
                metadata: {
                    ...chunk.metadata,
                    mentioned_entities: mentioned,
                },
            });
        }

        return out;
    }
}
