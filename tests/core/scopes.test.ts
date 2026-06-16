import { describe, it, expect } from "vitest";
import {
    makeScope,
    scopeToFilter,
    promoteScope,
    OrchidRAGLevel,
    SHARED_TENANT,
    scopeFromAuth,
} from "../../src/core/scopes.js";

describe("OrchidRAGScope", () => {
    it("makeScope with defaults", () => {
        const scope = makeScope({ tenantId: "t1" });
        expect(scope.tenantId).toBe("t1");
        expect(scope.userId).toBe("");
        expect(scope.chatId).toBe("");
        expect(scope.agentId).toBe("");
    });

    it("makeScope with all fields", () => {
        const scope = makeScope({ tenantId: "t1", userId: "u1", chatId: "c1", agentId: "a1" });
        expect(scope.tenantId).toBe("t1");
        expect(scope.userId).toBe("u1");
        expect(scope.chatId).toBe("c1");
        expect(scope.agentId).toBe("a1");
    });

    it("scopeToFilter builds filter dict", () => {
        const scope = makeScope({ tenantId: "t1", userId: "u1", chatId: "c1", agentId: "a1" });
        const filter = scopeToFilter(scope);
        expect(filter["tenant_id"]).toBe("t1");
        expect(filter["user_id"]).toBe("u1");
        expect(filter["chat_id"]).toBe("c1");
        expect(filter["agent_id"]).toBe("a1");
    });

    it("scopeToFilter excludes SHARED_TENANT", () => {
        const scope = makeScope({ tenantId: SHARED_TENANT, userId: "u1" });
        const filter = scopeToFilter(scope);
        expect(filter["tenant_id"]).toBeUndefined();
        expect(filter["user_id"]).toBe("u1");
    });

    it("promoteScope to USER level clears chat and agent", () => {
        const scope = makeScope({ tenantId: "t1", userId: "u1", chatId: "c1", agentId: "a1" });
        const promoted = promoteScope(scope, OrchidRAGLevel.USER);
        expect(promoted.tenantId).toBe("t1");
        expect(promoted.userId).toBe("u1");
        expect(promoted.chatId).toBe("");
        expect(promoted.agentId).toBe("");
    });

    it("promoteScope to CHAT level clears agent only", () => {
        const scope = makeScope({ tenantId: "t1", userId: "u1", chatId: "c1", agentId: "a1" });
        const promoted = promoteScope(scope, OrchidRAGLevel.CHAT);
        expect(promoted.chatId).toBe("c1");
        expect(promoted.agentId).toBe("");
    });

    it("promoteScope to ROOT sets SHARED_TENANT", () => {
        const scope = makeScope({ tenantId: "t1", userId: "u1" });
        const promoted = promoteScope(scope, OrchidRAGLevel.ROOT);
        expect(promoted.tenantId).toBe(SHARED_TENANT);
        expect(promoted.userId).toBe("");
        expect(promoted.chatId).toBe("");
        expect(promoted.agentId).toBe("");
    });

    it("scopeFromAuth helper", () => {
        const scope = scopeFromAuth("t1", "u1", "c1", "a1");
        expect(scope.tenantId).toBe("t1");
        expect(scope.userId).toBe("u1");
        expect(scope.chatId).toBe("c1");
        expect(scope.agentId).toBe("a1");
    });
});
