/** RAG scope — pure data type for hierarchical partition keys. */

export const SHARED_TENANT = "__shared__";

export interface OrchidRAGScope {
    readonly tenantId: string;
    readonly userId: string;
    readonly chatId: string;
    readonly agentId: string;
}

export enum OrchidRAGLevel {
    ROOT = 0,
    TENANT = 1,
    USER = 2,
    CHAT = 3,
    AGENT = 4,
}

export function makeScope(partial: Partial<OrchidRAGScope>): OrchidRAGScope {
    return {
        tenantId: partial.tenantId ?? "default",
        userId: partial.userId ?? "",
        chatId: partial.chatId ?? "",
        agentId: partial.agentId ?? "",
    };
}

export function scopeFromAuth(
    tenantKey: string,
    userId: string,
    chatId = "",
    agentId = "",
): OrchidRAGScope {
    return { tenantId: tenantKey, userId, chatId, agentId };
}

export function scopeToFilter(scope: OrchidRAGScope): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (scope.tenantId && scope.tenantId !== SHARED_TENANT) {
        filter["tenant_id"] = scope.tenantId;
    }
    if (scope.userId) {
        filter["user_id"] = scope.userId;
    }
    if (scope.chatId) {
        filter["chat_id"] = scope.chatId;
    }
    if (scope.agentId) {
        filter["agent_id"] = scope.agentId;
    }
    return filter;
}

export function promoteScope(scope: OrchidRAGScope, targetLevel: OrchidRAGLevel): OrchidRAGScope {
    const result = { ...scope };
    switch (targetLevel) {
        case OrchidRAGLevel.ROOT:
            return { tenantId: SHARED_TENANT, userId: "", chatId: "", agentId: "" };
        case OrchidRAGLevel.TENANT:
            return { ...result, userId: "", chatId: "", agentId: "" };
        case OrchidRAGLevel.USER:
            return { ...result, chatId: "", agentId: "" };
        case OrchidRAGLevel.CHAT:
            return { ...result, agentId: "" };
        case OrchidRAGLevel.AGENT:
            return result;
    }
}
