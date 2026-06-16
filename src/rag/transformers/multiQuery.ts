import { OrchidQueryTransformer } from "../../core/retrieval.js";

export const DEFAULT_MULTI_QUERY_PROMPT =
    "You are a search query generator.  Given a user question, generate " +
    "{n} alternative search queries that would help retrieve relevant " +
    "documents.  The queries should cover different phrasings, synonyms, " +
    "and aspects of the original question.\n" +
    "Output ONLY the queries, one per line.  No numbering, no explanation.";

export class MultiQueryTransformer extends OrchidQueryTransformer {
    readonly preStrategy: boolean = false;
    private numQueries: number;
    private systemPrompt: string;

    constructor({
        numQueries = 3,
        systemPrompt,
    }: {
        numQueries?: number;
        timeoutSeconds?: number;
        systemPrompt?: string;
    } = {}) {
        super();
        this.numQueries = numQueries;
        this.systemPrompt = systemPrompt ?? DEFAULT_MULTI_QUERY_PROMPT;
    }

    override get name(): string {
        return "multi_query";
    }

    override async transform(query: string, chatModel: unknown): Promise<string[]> {
        if (!chatModel) return [];

        try {
            const result = await (chatModel as any).invoke([
                {
                    role: "system",
                    content: this.systemPrompt.replace("{n}", String(this.numQueries)),
                },
                { role: "user", content: query },
            ]);
            const lines = ((result?.content as string) ?? "")
                .split("\n")
                .map((l: string) => l.trim())
                .filter(Boolean);
            return lines.slice(0, this.numQueries);
        } catch (err) {
            console.warn("[MultiQueryTransformer] Failed to generate variations: %s", err);
            return [];
        }
    }
}
