import { OrchidQueryTransformer } from "../../core/retrieval.js";

export const DEFAULT_SINGLE_PROMPT =
    "You are a hypothetical-document generator.  Given a user question, write a " +
    "single concise paragraph (3-5 sentences) that, if it appeared in a document, " +
    "would directly answer the question.  Use a confident, encyclopedic tone — the " +
    "paragraph does NOT need to be factually correct, only plausibly written.  " +
    "Output ONLY the paragraph; no preamble, no explanation.";

export const DEFAULT_MULTI_PROMPT =
    "You are a hypothetical-document generator.  Given a user question, write " +
    "{n} distinct concise paragraphs (3-5 sentences each) that each, if they " +
    "appeared in a document, would directly answer the question.  Vary phrasing " +
    "and angle so each paragraph covers a different facet of the answer.  Use " +
    "a confident, encyclopedic tone — the paragraphs do NOT need to be factually " +
    "correct, only plausibly written.  Output one paragraph per line.  Do not " +
    "number the paragraphs.";

export class HyDETransformer extends OrchidQueryTransformer {
    readonly preStrategy: boolean = false;
    private nHypothetical: number;
    private singlePrompt: string;
    private multiPrompt: string;

    constructor({
        nHypothetical = 1,
        singlePrompt,
        multiPrompt,
    }: {
        nHypothetical?: number;
        timeoutSeconds?: number;
        singlePrompt?: string;
        multiPrompt?: string;
    } = {}) {
        super();
        if (nHypothetical < 1) throw new Error(`nHypothetical must be >= 1; got ${nHypothetical}`);
        this.nHypothetical = nHypothetical;
        this.singlePrompt = singlePrompt ?? DEFAULT_SINGLE_PROMPT;
        this.multiPrompt = multiPrompt ?? DEFAULT_MULTI_PROMPT;
    }

    override get name(): string {
        return "hyde";
    }

    override async transform(query: string, chatModel: unknown): Promise<string[]> {
        if (!chatModel) return [];

        try {
            if (this.nHypothetical === 1) {
                const result = await (chatModel as any).invoke(
                    [
                        { role: "system", content: this.singlePrompt },
                        { role: "user", content: query },
                    ],
                    { temperature: 0.3 },
                );
                const text = ((result?.content as string) ?? "").trim();
                return text ? [text] : [];
            }
            const result = await (chatModel as any).invoke(
                [
                    {
                        role: "system",
                        content: this.multiPrompt.replace("{n}", String(this.nHypothetical)),
                    },
                    { role: "user", content: query },
                ],
                { temperature: 0.5 },
            );
            const lines = ((result?.content as string) ?? "")
                .split("\n")
                .map((l: string) => l.trim())
                .filter(Boolean);
            return lines.slice(0, this.nHypothetical);
        } catch (err) {
            console.warn("[HyDETransformer] Failed: %s", err);
            return [];
        }
    }
}
