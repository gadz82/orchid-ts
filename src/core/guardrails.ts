/** Guardrail ABCs — input/output firewalls for agents and orchestrator. */

export enum OrchidGuardrailAction {
    ALLOW = "allow",
    BLOCK = "block",
    REDACT = "redact",
    WARN = "warn",
    LOG = "log",
}

export enum OrchidGuardrailDirection {
    INPUT = "input",
    OUTPUT = "output",
}

export interface OrchidGuardrailContext {
    readonly direction: OrchidGuardrailDirection;
    readonly agentName: string;
    readonly tenantKey: string;
    readonly userId: string;
    readonly chatId: string;
    readonly metadata: Record<string, unknown>;
}

export class OrchidGuardrailResult {
    triggered: boolean;
    action: OrchidGuardrailAction;
    guardrailName: string;
    message: string;
    redactedContent: string | null;
    details: Record<string, unknown>;

    constructor({
        triggered,
        action = OrchidGuardrailAction.ALLOW,
        guardrailName = "",
        message = "",
        redactedContent = null,
        details = {},
    }: {
        triggered: boolean;
        action?: OrchidGuardrailAction;
        guardrailName?: string;
        message?: string;
        redactedContent?: string | null;
        details?: Record<string, unknown>;
    }) {
        this.triggered = triggered;
        this.action = action;
        this.guardrailName = guardrailName;
        this.message = message;
        this.redactedContent = redactedContent;
        this.details = details;
    }

    get blocked(): boolean {
        return this.triggered && this.action === OrchidGuardrailAction.BLOCK;
    }

    static passed(guardrailName = ""): OrchidGuardrailResult {
        return new OrchidGuardrailResult({ triggered: false, guardrailName });
    }
}

export abstract class OrchidGuardrail {
    abstract get name(): string;

    abstract check(
        content: string,
        context: OrchidGuardrailContext,
    ): Promise<OrchidGuardrailResult>;
}

export class OrchidGuardrailChain {
    private guardrails: OrchidGuardrail[] = [];

    constructor(guardrails?: OrchidGuardrail[]) {
        if (guardrails) this.guardrails = [...guardrails];
    }

    get empty(): boolean {
        return this.guardrails.length === 0;
    }

    get length(): number {
        return this.guardrails.length;
    }

    add(guardrail: OrchidGuardrail): void {
        this.guardrails.push(guardrail);
    }

    async evaluate(
        content: string,
        context: OrchidGuardrailContext,
    ): Promise<OrchidGuardrailResult> {
        let currentContent = content;
        let lastRedact: OrchidGuardrailResult | null = null;
        const warnings: OrchidGuardrailResult[] = [];

        for (const guardrail of this.guardrails) {
            const result = await guardrail.check(currentContent, context);

            if (!result.triggered) continue;

            if (result.action === OrchidGuardrailAction.BLOCK) return result;

            if (result.action === OrchidGuardrailAction.REDACT && result.redactedContent !== null) {
                currentContent = result.redactedContent;
                lastRedact = result;
            }

            if (
                result.action === OrchidGuardrailAction.WARN ||
                result.action === OrchidGuardrailAction.LOG
            ) {
                warnings.push(result);
            }
        }

        if (lastRedact) return lastRedact;
        if (warnings.length > 0) return warnings[0];
        return OrchidGuardrailResult.passed();
    }
}
