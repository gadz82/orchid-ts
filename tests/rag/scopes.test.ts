import { describe, it, expect } from "vitest";
import {
    SHARED_TENANT,
    makeScope,
    scopeFromAuth,
    scopeToFilter,
    promoteScope,
    OrchidRAGLevel,
} from "../../src/rag/scopes.js";

describe("RAG Scopes (rag/ re-exports)", () => {
    describe("SHARED_TENANT", () => {
        it("is the expected constant", () => {
            expect(SHARED_TENANT).toBe("__shared__");
        });
    });

    describe("makeScope", () => {
        it("fills defaults for missing fields", () => {
            const scope = makeScope({});
            expect(scope).toEqual({
                tenantId: "default",
                userId: "",
                chatId: "",
                agentId: "",
            });
        });

        it("uses provided values", () => {
            const scope = makeScope({
                tenantId: "t1",
                userId: "u1",
                chatId: "c1",
                agentId: "a1",
            });
            expect(scope).toEqual({
                tenantId: "t1",
                userId: "u1",
                chatId: "c1",
                agentId: "a1",
            });
        });

        it("partial overrides only specified fields", () => {
            const scope = makeScope({ agentId: "my-agent" });
            expect(scope.agentId).toBe("my-agent");
            expect(scope.tenantId).toBe("default");
            expect(scope.userId).toBe("");
        });
    });

    describe("scopeFromAuth", () => {
        it("creates scope from auth fields", () => {
            const scope = scopeFromAuth("tenant1", "user1", "chat1", "agent1");
            expect(scope).toEqual({
                tenantId: "tenant1",
                userId: "user1",
                chatId: "chat1",
                agentId: "agent1",
            });
        });

        it("uses empty strings for missing chatId and agentId", () => {
            const scope = scopeFromAuth("tenant1", "user1");
            expect(scope.chatId).toBe("");
            expect(scope.agentId).toBe("");
        });
    });

    describe("scopeToFilter", () => {
        it("builds filter with non-empty scope fields", () => {
            const scope = makeScope({ tenantId: "t1", userId: "u1", chatId: "c1", agentId: "a1" });
            const filter = scopeToFilter(scope);
            expect(filter).toEqual({
                tenant_id: "t1",
                user_id: "u1",
                chat_id: "c1",
                agent_id: "a1",
            });
        });

        it("omits empty fields", () => {
            const scope = makeScope({ tenantId: "t1" });
            const filter = scopeToFilter(scope);
            expect(filter).toEqual({ tenant_id: "t1" });
            expect(filter).not.toHaveProperty("user_id");
            expect(filter).not.toHaveProperty("chat_id");
            expect(filter).not.toHaveProperty("agent_id");
        });

        it("omits tenant_id when SHARED_TENANT", () => {
            const scope = makeScope({ tenantId: SHARED_TENANT, userId: "u1" });
            const filter = scopeToFilter(scope);
            expect(filter).not.toHaveProperty("tenant_id");
            expect(filter).toHaveProperty("user_id", "u1");
        });
    });

    describe("promoteScope", () => {
        const fullScope = makeScope({ tenantId: "t1", userId: "u1", chatId: "c1", agentId: "a1" });

        it("promotes to ROOT level", () => {
            const result = promoteScope(fullScope, OrchidRAGLevel.ROOT);
            expect(result).toEqual({
                tenantId: SHARED_TENANT,
                userId: "",
                chatId: "",
                agentId: "",
            });
        });

        it("promotes to TENANT level", () => {
            const result = promoteScope(fullScope, OrchidRAGLevel.TENANT);
            expect(result).toEqual({
                tenantId: "t1",
                userId: "",
                chatId: "",
                agentId: "",
            });
        });

        it("promotes to USER level", () => {
            const result = promoteScope(fullScope, OrchidRAGLevel.USER);
            expect(result).toEqual({
                tenantId: "t1",
                userId: "u1",
                chatId: "",
                agentId: "",
            });
        });

        it("promotes to CHAT level", () => {
            const result = promoteScope(fullScope, OrchidRAGLevel.CHAT);
            expect(result).toEqual({
                tenantId: "t1",
                userId: "u1",
                chatId: "c1",
                agentId: "",
            });
        });

        it("promotes to AGENT level (no change)", () => {
            const result = promoteScope(fullScope, OrchidRAGLevel.AGENT);
            expect(result).toEqual(fullScope);
        });
    });
});
