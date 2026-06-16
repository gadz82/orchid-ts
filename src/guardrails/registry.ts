import { OrchidGuardrailChain } from "../core/index.js";
import type { OrchidGuardrail } from "../core/index.js";
import { MaxLengthGuardrail } from "./maxLength.js";
import { PIIDetectionGuardrail } from "./pii.js";
import { PromptInjectionGuardrail } from "./promptInjection.js";
import { TopicRestrictionGuardrail } from "./topicRestriction.js";
import { ContentSafetyGuardrail } from "./contentSafety.js";
import { GroundednessGuardrail } from "./groundedness.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GuardrailConstructor = new (...args: any[]) => OrchidGuardrail;

const GUARDRAIL_REGISTRY: Map<string, GuardrailConstructor> = new Map();

export function registerGuardrail(name: string, cls: GuardrailConstructor): void {
    GUARDRAIL_REGISTRY.set(name, cls);
}

export function getGuardrail(name: string): GuardrailConstructor | null {
    return GUARDRAIL_REGISTRY.get(name) ?? null;
}

export function buildGuardrailChain(
    configs: Array<{
        type: string;
        failAction?: string;
        config?: Record<string, unknown>;
    }>,
): OrchidGuardrailChain {
    const chain = new OrchidGuardrailChain();

    for (const cfg of configs) {
        const Ctor = getGuardrail(cfg.type);
        if (!Ctor) continue;

        const instance = new Ctor({
            failAction: cfg.failAction,
            ...(cfg.config ?? {}),
        });
        chain.add(instance);
    }

    return chain;
}

function autoRegister(): void {
    registerGuardrail("max_length", MaxLengthGuardrail);
    registerGuardrail("content_safety", ContentSafetyGuardrail);
    registerGuardrail("prompt_injection", PromptInjectionGuardrail);
    registerGuardrail("pii_detection", PIIDetectionGuardrail);
    registerGuardrail("topic_restriction", TopicRestrictionGuardrail);
    registerGuardrail("groundedness", GroundednessGuardrail);
}

autoRegister();
