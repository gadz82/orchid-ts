import { OrchidGuardrail, OrchidGuardrailResult, OrchidGuardrailAction } from "../core/index.js";
import type { OrchidGuardrailContext } from "../core/index.js";

const DEFAULT_PATTERNS: string[] = [
    "ignore all previous instructions",
    "ignore previous instructions",
    "disregard all previous",
    "forget all previous",
    "override your instructions",
    "you are now DAN",
    "you are now a new",
    "act as if you are",
    "system:",
    "system message:",
    "<im_start>system",
    "<im_end>",
    "you are a helpful assistant",
    "you are an AI assistant",
    "do not follow your guidelines",
    "bypass your restrictions",
    "jailbreak",
    "prompt injection",
];

export class PromptInjectionGuardrail extends OrchidGuardrail {
    private failAction: OrchidGuardrailAction;
    private patterns: string[];

    constructor(opts?: { failAction?: string; patterns?: string[] }) {
        super();
        this.failAction = parseFailAction(opts?.failAction);
        this.patterns = opts?.patterns ?? DEFAULT_PATTERNS;
    }

    get name(): string {
        return "prompt_injection";
    }

    async check(content: string, _context: OrchidGuardrailContext): Promise<OrchidGuardrailResult> {
        const lowerContent = content.toLowerCase();

        for (const pattern of this.patterns) {
            if (lowerContent.includes(pattern)) {
                return new OrchidGuardrailResult({
                    triggered: true,
                    action: this.failAction,
                    guardrailName: this.name,
                    message: `Potential prompt injection detected: "${pattern}"`,
                    details: { matchedPattern: pattern },
                });
            }
        }

        return OrchidGuardrailResult.passed(this.name);
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
