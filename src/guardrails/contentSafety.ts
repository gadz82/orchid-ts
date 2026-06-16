import { OrchidGuardrail, OrchidGuardrailResult, OrchidGuardrailAction } from "../core/index.js";
import type { OrchidGuardrailContext } from "../core/index.js";

const UNSAFE_KEYWORDS: string[] = [
    "violence",
    "terrorism",
    "child abuse",
    "self-harm",
    "suicide",
    "hate speech",
    "harassment",
    "explicit content",
    "illegal activities",
    "weapons manufacturing",
    "drug trafficking",
    "human trafficking",
];

export class ContentSafetyGuardrail extends OrchidGuardrail {
    private failAction: OrchidGuardrailAction;

    constructor(opts?: { failAction?: string }) {
        super();
        this.failAction = parseFailAction(opts?.failAction);
    }

    get name(): string {
        return "content_safety";
    }

    async check(content: string, _context: OrchidGuardrailContext): Promise<OrchidGuardrailResult> {
        const lowerContent = content.toLowerCase();

        for (const keyword of UNSAFE_KEYWORDS) {
            if (lowerContent.includes(keyword)) {
                return new OrchidGuardrailResult({
                    triggered: true,
                    action: this.failAction,
                    guardrailName: this.name,
                    message: `Content safety concern: matched keyword "${keyword}"`,
                    details: { matchedKeyword: keyword },
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
