import { OrchidGuardrail, OrchidGuardrailResult, OrchidGuardrailAction } from "../core/index.js";
import type { OrchidGuardrailContext } from "../core/index.js";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const CREDIT_CARD_RE = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

const ENTITY_PATTERNS: Record<string, { regex: RegExp; replacement: string }> = {
    email: { regex: EMAIL_RE, replacement: "[EMAIL_REDACTED]" },
    phone: { regex: PHONE_RE, replacement: "[PHONE_REDACTED]" },
    credit_card: { regex: CREDIT_CARD_RE, replacement: "[CREDIT_CARD_REDACTED]" },
    ssn: { regex: SSN_RE, replacement: "[SSN_REDACTED]" },
    ipv4: { regex: IPV4_RE, replacement: "[IP_REDACTED]" },
};

const DEFAULT_ENTITIES = Object.keys(ENTITY_PATTERNS);

interface PIIDetectionOpts {
    failAction?: string;
    entities?: string[];
}

export class PIIDetectionGuardrail extends OrchidGuardrail {
    private failAction: OrchidGuardrailAction;
    private entities: string[];

    constructor(opts?: PIIDetectionOpts) {
        super();
        this.failAction = parseFailAction(opts?.failAction);
        this.entities = opts?.entities ?? DEFAULT_ENTITIES;
    }

    get name(): string {
        return "pii_detection";
    }

    async check(content: string, _context: OrchidGuardrailContext): Promise<OrchidGuardrailResult> {
        for (const entity of this.entities) {
            const pattern = ENTITY_PATTERNS[entity];
            if (!pattern) continue;

            const match = content.match(pattern.regex);
            if (!match || match.length === 0) continue;

            if (this.failAction === OrchidGuardrailAction.REDACT) {
                const redactedContent = this.redactAll(content);
                return new OrchidGuardrailResult({
                    triggered: true,
                    action: OrchidGuardrailAction.REDACT,
                    guardrailName: this.name,
                    message: `PII detected (${entity}) — content redacted`,
                    redactedContent,
                    details: { entity, matches: match },
                });
            }

            return new OrchidGuardrailResult({
                triggered: true,
                action: this.failAction,
                guardrailName: this.name,
                message: `PII detected (${entity})`,
                details: { entity, matches: match },
            });
        }

        return OrchidGuardrailResult.passed(this.name);
    }

    private redactAll(content: string): string {
        let result = content;
        for (const entity of this.entities) {
            const pattern = ENTITY_PATTERNS[entity];
            if (!pattern) continue;
            result = result.replace(pattern.regex, pattern.replacement);
        }
        return result;
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
