import { OrchidGuardrail, OrchidGuardrailResult, OrchidGuardrailAction } from "../core/index.js";
import type { OrchidGuardrailContext } from "../core/index.js";

const TOPIC_CHECK_PROMPT = `You are a content classifier. Determine if the following content is within the specified topic boundaries.

Allowed topics: {allowedTopics}
Blocked topics: {blockedTopics}

Respond with ONLY "ALLOWED" or "BLOCKED". If the content is within allowed topics and not in blocked topics, respond ALLOWED. Otherwise respond BLOCKED.`;

interface TopicRestrictionOpts {
    failAction?: string;
    allowedTopics?: string[];
    blockedTopics?: string[];
    chatModel?: unknown | null;
}

export class TopicRestrictionGuardrail extends OrchidGuardrail {
    private failAction: OrchidGuardrailAction;
    private allowedTopics: string[];
    private blockedTopics: string[];
    private chatModel: unknown | null;

    constructor(opts?: TopicRestrictionOpts) {
        super();
        this.failAction = parseFailAction(opts?.failAction);
        this.allowedTopics = opts?.allowedTopics ?? [];
        this.blockedTopics = opts?.blockedTopics ?? [];
        this.chatModel = opts?.chatModel ?? null;
    }

    get name(): string {
        return "topic_restriction";
    }

    async check(content: string, _context: OrchidGuardrailContext): Promise<OrchidGuardrailResult> {
        if (this.allowedTopics.length === 0 && this.blockedTopics.length === 0) {
            return OrchidGuardrailResult.passed(this.name);
        }

        if (!this.chatModel) {
            return OrchidGuardrailResult.passed(this.name);
        }

        try {
            const prompt = TOPIC_CHECK_PROMPT.replace(
                "{allowedTopics}",
                this.allowedTopics.join(", ") || "any",
            ).replace("{blockedTopics}", this.blockedTopics.join(", ") || "none");

            const model = this.chatModel as {
                invoke: (
                    msgs: Array<{ role: string; content: string }>,
                ) => Promise<{ content: string }>;
            };
            const response = await model.invoke([
                { role: "system", content: prompt },
                { role: "user", content },
            ]);

            const verdict = (response.content ?? "").trim().toUpperCase();

            if (verdict === "BLOCKED") {
                return new OrchidGuardrailResult({
                    triggered: true,
                    action: this.failAction,
                    guardrailName: this.name,
                    message: "Content falls outside allowed topics or within blocked topics",
                    details: {
                        allowedTopics: this.allowedTopics,
                        blockedTopics: this.blockedTopics,
                        verdict,
                    },
                });
            }

            return OrchidGuardrailResult.passed(this.name);
        } catch (err) {
            console.error("[topic_restriction] LLM check failed, falling back to pass: %s", err);
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
