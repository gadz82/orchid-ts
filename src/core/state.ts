/**
 * Shared state definitions for the LangGraph agent graph.
 *
 * OrchidAuthContext is the identity envelope propagated to every agent and MCP client.
 * Auth is NOT graph state — it travels in the RunnableConfig.
 */

export class OrchidAuthContext {
    accessToken: string;
    expiresAt: number;
    extra: Record<string, unknown>;
    roles: ReadonlySet<string>;

    constructor({
        accessToken,
        tenantKey = "default",
        userId = "",
        expiresAt = 0.0,
        extra,
        roles,
    }: {
        accessToken: string;
        tenantKey?: string;
        userId?: string;
        expiresAt?: number;
        extra?: Record<string, unknown>;
        roles?: Iterable<string> | null;
    }) {
        this.accessToken = accessToken;
        this._tenantKey = tenantKey;
        this._userId = userId;
        this.expiresAt = expiresAt;
        this.extra = extra ?? {};
        this.roles = new Set(roles ?? []);
    }

    private _tenantKey: string;

    get tenantKey(): string {
        return this._tenantKey || "default";
    }

    private _userId: string;

    get userId(): string {
        return this._userId;
    }

    get isExpired(): boolean {
        return this.expiresAt > 0 && Date.now() / 1000 >= this.expiresAt;
    }

    get bearerHeader(): Record<string, string> {
        return { Authorization: `Bearer ${this.accessToken}` };
    }

    static fromStorageDict({
        accessToken,
        expiresAt,
        state,
    }: {
        accessToken: string;
        expiresAt: number;
        state: Record<string, unknown>;
    }): OrchidAuthContext {
        const roles = (state["roles"] as string[]) ?? [];
        return new OrchidAuthContext({
            accessToken,
            tenantKey: (state["tenant_key"] as string) ?? "default",
            userId: (state["user_id"] as string) ?? "",
            expiresAt,
            extra: (state["extra"] as Record<string, unknown>) ?? {},
            roles,
        });
    }

    toStorageDict(): Record<string, unknown> {
        return {
            tenant_key: this._tenantKey,
            user_id: this._userId,
            extra: { ...this.extra },
            roles: [...this.roles].sort(),
        };
    }

    samePrincipal(other: OrchidAuthContext): boolean {
        return this.tenantKey === other.tenantKey && this.userId === other.userId;
    }

    /** Two contexts are equal if they represent the same principal */
    equals(other: unknown): boolean {
        if (!(other instanceof OrchidAuthContext)) return false;
        return this.samePrincipal(other);
    }

    toString(): string {
        return `OrchidAuthContext(tenant_key=${this.tenantKey}, user_id=${this.userId}, expired=${this.isExpired})`;
    }
}

/** Canonical state schema for the LangGraph graph. */
export interface OrchidAgentState {
    messages: unknown[];
    /** Auth is NOT in state — travels in the RunnableConfig via core/runConfig.ts */
    chatId: string;
    activeAgents: string[];
    mcpContext: Record<string, unknown>;
    ragContext: Record<string, unknown>;
    finalResponse: string | null;
    skillInstructions: Record<string, string>;
    _hasOutputGuardrails: boolean;
}

export type OrchidAgentStateLike = Partial<OrchidAgentState>;
