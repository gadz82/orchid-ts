import { OrchidQueryTransformer } from "../../core/retrieval.js";

export const DEFAULT_DECOMPOSE_PROMPT =
    "You decompose complex multi-part questions into independent sub-questions, " +
    "each of which can be answered without reference to the others.\n" +
    "RULES:\n" +
    "- Output AT MOST {n} sub-questions, one per line.\n" +
    "- If the question is already atomic, output it on a single line unchanged.\n" +
    "- Each sub-question must stand on its own — no pronouns referring back to " +
    "  other sub-questions.\n" +
    "- No numbering, no preamble, no explanation.";

export class DecomposeTransformer extends OrchidQueryTransformer {
    readonly preStrategy: boolean = false;
    private maxSubQueries: number;
    private systemPrompt: string;

    constructor({
        maxSubQueries = 4,
        systemPrompt,
    }: {
        maxSubQueries?: number;
        timeoutSeconds?: number;
        systemPrompt?: string;
    } = {}) {
        super();
        if (maxSubQueries < 2) throw new Error(`maxSubQueries must be >= 2; got ${maxSubQueries}`);
        this.maxSubQueries = maxSubQueries;
        this.systemPrompt = systemPrompt ?? DEFAULT_DECOMPOSE_PROMPT;
    }

    override get name(): string {
        return "decompose";
    }

    override async transform(query: string, chatModel: unknown): Promise<string[]> {
        if (!chatModel) return [];

        try {
            const result = await (chatModel as any).invoke(
                [
                    {
                        role: "system",
                        content: this.systemPrompt.replace("{n}", String(this.maxSubQueries)),
                    },
                    { role: "user", content: query },
                ],
                { temperature: 0 },
            );
            const lines = ((result?.content as string) ?? "")
                .split("\n")
                .map((l: string) => l.trim())
                .filter(Boolean);
            return lines.slice(0, this.maxSubQueries);
        } catch (err) {
            console.warn("[DecomposeTransformer] Failed: %s", err);
            return [];
        }
    }
}
