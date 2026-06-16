/**
 * Auth as execution context — carried in the LangGraph RunnableConfig,
 * never in the (checkpointed) graph state.
 */
import type { OrchidAuthContext } from "./state.js";

export const CONFIG_KEY_AUTH = "auth_context";

export function authFromConfig(
    config: Record<string, unknown> | null | undefined,
): OrchidAuthContext | null {
    if (!config) return null;
    const configurable = (config["configurable"] as Record<string, unknown>) ?? {};
    return (configurable[CONFIG_KEY_AUTH] as OrchidAuthContext) ?? null;
}

export function withAuth(
    auth: OrchidAuthContext | null,
    { threadId, base }: { threadId?: string; base?: Record<string, unknown> } = {},
): Record<string, unknown> {
    const cfg: Record<string, unknown> = { ...(base ?? {}) };
    const configurable: Record<string, unknown> = {
        ...((cfg["configurable"] as Record<string, unknown>) ?? {}),
    };
    if (auth !== null) {
        configurable[CONFIG_KEY_AUTH] = auth;
    }
    if (threadId !== undefined) {
        configurable["thread_id"] = threadId;
    }
    cfg["configurable"] = configurable;
    return cfg;
}
