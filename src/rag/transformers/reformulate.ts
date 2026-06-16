import { OrchidQueryTransformer } from "../../core/retrieval.js";

export const DEFAULT_REFORMULATE_PROMPT =
    "You are a query reformulation assistant. Given the conversation history " +
    "and the user's latest message, rewrite the message as a clear, standalone " +
    "search query that can be used to search a database or menu.\n\n" +
    "RULES:\n" +
    "- Resolve pronouns and references ('it', 'that', 'the first one', 'yes')\n" +
    "- Extract the core intent (what the user actually wants)\n" +
    "- Keep it short and specific (under 20 words)\n" +
    "- If the query is already clear and standalone, return it unchanged\n" +
    "- Return ONLY the reformulated query, nothing else";

export class ReformulateTransformer extends OrchidQueryTransformer {
    readonly preStrategy: boolean = true;
    private systemPrompt: string;

    constructor({ systemPrompt }: { systemPrompt?: string } = {}) {
        super();
        this.systemPrompt = systemPrompt ?? DEFAULT_REFORMULATE_PROMPT;
    }

    override get name(): string {
        return "reformulate";
    }

    override async transform(query: string, chatModel: unknown): Promise<string[]> {
        if (!chatModel) return [query];

        try {
            const messages = [
                { role: "system", content: this.systemPrompt },
                { role: "user", content: query },
            ];
            const result = await (chatModel as any).invoke(messages, { temperature: 0 });
            const reformulated = ((result?.content as string) ?? "").trim();
            if (reformulated && reformulated.length < 200) {
                console.error(
                    "[ReformulateTransformer] '%s' -> '%s'",
                    query.slice(0, 80),
                    reformulated.slice(0, 80),
                );
                return [reformulated];
            }
        } catch (err) {
            console.warn("[ReformulateTransformer] Failed: %s", err);
        }

        return [query];
    }
}
