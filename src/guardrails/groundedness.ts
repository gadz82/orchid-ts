import { OrchidGuardrail, OrchidGuardrailResult, OrchidGuardrailAction } from "../core/index.js";
import { extractTextContent } from "../core/helpers.js";
import type { OrchidGuardrailContext } from "../core/index.js";

const GROUNDEDNESS_PROMPT = `You are a factuality evaluator. Assess whether the following response is factually grounded and does not contain hallucinated information.

Respond with ONLY "GROUNDED" or "HALLUCINATED". 

- GROUNDED: The response is factually accurate and verifiable.
- HALLUCINATED: The response contains fabricated, unsupported, or speculative claims.`;

interface GroundednessOpts {
    failAction?: string;
    chatModel?: unknown | null;
}

export class GroundednessGuardrail extends OrchidGuardrail {
    private failAction: OrchidGuardrailAction;
    private chatModel: unknown | null;

    constructor(opts?: GroundednessOpts) {
        super();
        this.failAction = parseFailAction(opts?.failAction);
        this.chatModel = opts?.chatModel ?? null;
    }

    get name(): string {
        return "groundedness";
    }

    async check(content: string, _context: OrchidGuardrailContext): Promise<OrchidGuardrailResult> {
        if (!this.chatModel) {
            return OrchidGuardrailResult.passed(this.name);
        }

        try {
            const model = this.chatModel as {
                invoke: (
                    msgs: Array<{ role: string; content: string }>,
                ) => Promise<{ content: string }>;
            };
            const response = await model.invoke([
                { role: "system", content: GROUNDEDNESS_PROMPT },
                { role: "user", content },
            ]);

            const verdict = extractTextContent(response.content).trim().toUpperCase();

            if (verdict === "HALLUCINATED") {
                return new OrchidGuardrailResult({
                    triggered: true,
                    action: this.failAction,
                    guardrailName: this.name,
                    message: "Content may contain hallucinated or ungrounded information",
                    details: { verdict },
                });
            }

            return OrchidGuardrailResult.passed(this.name);
        } catch (err) {
            console.error("[groundedness] LLM check failed, falling back to pass: %s", err);
            return OrchidGuardrailResult.passed(this.name);
        }
    }
}

function parseFailAction(action?: string): OrchidGuardrailAction {
    if (!action) return OrchidGuardrailAction.BLOCK;
    const upper = action.toUpperCase();
    if (upper === "BLOCK") return OrchidGuardrailAction.BLOCK;
    if (upper === "WARN") return OrchidGuardrailAction.WARN;
    if (upper === "REDACT") return OrchidGuardrailAction.REDACT;
    if (upper === "LOG") return OrchidGuardrailAction.LOG;
    return OrchidGuardrailAction.BLOCK;
}
