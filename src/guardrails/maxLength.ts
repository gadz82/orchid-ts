import { OrchidGuardrail, OrchidGuardrailResult, OrchidGuardrailAction } from "../core/index.js";
import type { OrchidGuardrailContext } from "../core/index.js";

const DEFAULT_MAX_CHARACTERS = 100000;

export class MaxLengthGuardrail extends OrchidGuardrail {
    private maxCharacters: number;
    private failAction: OrchidGuardrailAction;

    constructor(opts?: { failAction?: string; maxCharacters?: number }) {
        super();
        this.maxCharacters = opts?.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
        this.failAction = parseFailAction(opts?.failAction);
    }

    get name(): string {
        return "max_length";
    }

    async check(content: string, _context: OrchidGuardrailContext): Promise<OrchidGuardrailResult> {
        if (content.length <= this.maxCharacters) {
            return OrchidGuardrailResult.passed(this.name);
        }

        return new OrchidGuardrailResult({
            triggered: true,
            action: this.failAction,
            guardrailName: this.name,
            message: `Content length ${content.length} exceeds maximum ${this.maxCharacters} characters`,
            details: {
                contentLength: content.length,
                maxCharacters: this.maxCharacters,
            },
        });
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
