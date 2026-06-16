import {
    OrchidGuardrailAction,
    OrchidGuardrailChain,
    OrchidGuardrailDirection,
} from "../core/guardrails.js";
import type { OrchidGuardrailContext } from "../core/guardrails.js";
import { OrchidAgent } from "../core/agent.js";
import { authFromConfig } from "../core/runConfig.js";
import type { GraphState } from "./state.js";

export class GuardrailWiring {
    static async buildChains(guardrailsConfig: Record<string, unknown> | null): Promise<{
        input: OrchidGuardrailChain;
        output: OrchidGuardrailChain;
    }> {
        const inputRules = (guardrailsConfig?.input as Array<Record<string, unknown>>) ?? [];
        const outputRules = (guardrailsConfig?.output as Array<Record<string, unknown>>) ?? [];

        const inputConfigs = inputRules.map((r) => ({
            type: r.type as string,
            failAction: r.failAction as string,
            ...((r.config as Record<string, unknown>) ?? {}),
        }));

        const outputConfigs = outputRules.map((r) => ({
            type: r.type as string,
            failAction: r.failAction as string,
            ...((r.config as Record<string, unknown>) ?? {}),
        }));

        let inputChain: OrchidGuardrailChain;
        let outputChain: OrchidGuardrailChain;
        try {
            const { buildGuardrailChain } = await import("../guardrails/registry.js");
            inputChain = buildGuardrailChain(inputConfigs as any);
            outputChain = buildGuardrailChain(outputConfigs as any);
        } catch {
            inputChain = new OrchidGuardrailChain();
            outputChain = new OrchidGuardrailChain();
        }

        return { input: inputChain, output: outputChain };
    }

    static createGlobalInputNode(
        chain: OrchidGuardrailChain,
    ): (state: GraphState, config?: Record<string, unknown>) => Promise<Partial<GraphState>> {
        async function inputGuardrailsNode(
            state: GraphState,
            config?: Record<string, unknown>,
        ): Promise<Partial<GraphState>> {
            if (chain.empty) return state as Partial<GraphState>;

            const query = OrchidAgent.extractUserQuery(state as any);
            if (!query) return state as unknown as Partial<GraphState>;

            const auth = authFromConfig(config);
            const ctx: OrchidGuardrailContext = {
                direction: OrchidGuardrailDirection.INPUT,
                agentName: "",
                tenantKey: auth?.tenantKey ?? "default",
                userId: auth?.userId ?? "",
                chatId: state.chatId ?? "",
                metadata: {},
            };

            const result = await chain.evaluate(query, ctx);
            if (result.blocked) {
                console.warn(
                    "[Guardrails] Global input blocked by '%s': %s",
                    result.guardrailName,
                    result.message,
                );
                return {
                    messages: [{ role: "ai", content: result.message }] as unknown[],
                    finalResponse: result.message,
                    activeAgents: [],
                    pendingAgents: [],
                };
            }

            if (result.action === OrchidGuardrailAction.REDACT && result.redactedContent != null) {
                console.info("[Guardrails] Global input redacted by '%s'", result.guardrailName);
                const messages = [...((state.messages ?? []) as Array<Record<string, unknown>>)];
                if (messages.length > 0) {
                    const last = messages[messages.length - 1];
                    const lastType = typeof last["type"] === "string" ? last["type"] : "";
                    if (lastType === "human") {
                        messages[messages.length - 1] = {
                            ...last,
                            content: result.redactedContent,
                        };
                    }
                }
                return { messages: messages as unknown[] };
            }

            return state as Partial<GraphState>;
        }

        return inputGuardrailsNode;
    }

    static createGlobalOutputNode(
        chain: OrchidGuardrailChain,
    ): (state: GraphState, config?: Record<string, unknown>) => Promise<Partial<GraphState>> {
        async function outputGuardrailsNode(
            state: GraphState,
            config?: Record<string, unknown>,
        ): Promise<Partial<GraphState>> {
            if (chain.empty) return state as Partial<GraphState>;

            const final = state.finalResponse ?? null;
            if (!final) return state as Partial<GraphState>;

            const auth = authFromConfig(config);
            const ctx: OrchidGuardrailContext = {
                direction: OrchidGuardrailDirection.OUTPUT,
                agentName: "",
                tenantKey: auth?.tenantKey ?? "default",
                userId: auth?.userId ?? "",
                chatId: state.chatId ?? "",
                metadata: { ragContext: state.ragContext ?? {} },
            };

            const result = await chain.evaluate(final, ctx);
            if (result.blocked) {
                console.warn(
                    "[Guardrails] Global output blocked by '%s': %s",
                    result.guardrailName,
                    result.message,
                );
                return {
                    messages: [{ role: "ai", content: result.message }] as unknown[],
                    finalResponse: result.message,
                };
            }

            if (result.action === OrchidGuardrailAction.REDACT && result.redactedContent != null) {
                console.info("[Guardrails] Global output redacted by '%s'", result.guardrailName);
                return {
                    messages: [{ role: "ai", content: result.redactedContent }] as unknown[],
                    finalResponse: result.redactedContent,
                };
            }

            return state as Partial<GraphState>;
        }

        return outputGuardrailsNode;
    }
}
