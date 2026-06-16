import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OrchidSQLiteMCPTokenStore } from "../../src/persistence/mcpTokenSqlite.js";
import { OrchidMCPTokenRecord } from "../../src/core/mcpTokens.js";

let store: OrchidSQLiteMCPTokenStore;

beforeEach(async () => {
    store = new OrchidSQLiteMCPTokenStore(":memory:");
    await store.initDb();
});

afterEach(async () => {
    await store.close();
});

describe("OrchidSQLiteMCPTokenStore", () => {
    it("saves and retrieves a token", async () => {
        const record = new OrchidMCPTokenRecord({
            serverName: "test-server",
            tenantId: "t1",
            userId: "u1",
            accessToken: "access-123",
            refreshToken: "refresh-456",
            expiresAt: Date.now() / 1000 + 3600,
            scopes: "read write",
        });
        await store.saveToken(record);

        const retrieved = await store.getToken("t1", "u1", "test-server");
        expect(retrieved).not.toBeNull();
        expect(retrieved!.accessToken).toBe("access-123");
        expect(retrieved!.refreshToken).toBe("refresh-456");
        expect(retrieved!.scopes).toBe("read write");
    });

    it("returns null for missing token", async () => {
        const result = await store.getToken("t1", "u1", "nonexistent");
        expect(result).toBeNull();
    });

    it("lists tokens for a user", async () => {
        await store.saveToken(
            new OrchidMCPTokenRecord({
                serverName: "server-a",
                tenantId: "t1",
                userId: "u1",
                accessToken: "tok-a",
            }),
        );
        await store.saveToken(
            new OrchidMCPTokenRecord({
                serverName: "server-b",
                tenantId: "t1",
                userId: "u1",
                accessToken: "tok-b",
            }),
        );

        const tokens = await store.listTokens("t1", "u1");
        expect(tokens).toHaveLength(2);
    });

    it("deletes a token", async () => {
        await store.saveToken(
            new OrchidMCPTokenRecord({
                serverName: "to-delete",
                tenantId: "t1",
                userId: "u1",
                accessToken: "tok",
            }),
        );
        const deleted = await store.deleteToken("t1", "u1", "to-delete");
        expect(deleted).toBe(true);

        const result = await store.getToken("t1", "u1", "to-delete");
        expect(result).toBeNull();
    });

    it("deleteToken returns false for missing token", async () => {
        const result = await store.deleteToken("t1", "u1", "nonexistent");
        expect(result).toBe(false);
    });

    it("cleans up expired tokens", async () => {
        // Save an expired token
        const record = new OrchidMCPTokenRecord({
            serverName: "expired",
            tenantId: "t1",
            userId: "u1",
            accessToken: "old",
            expiresAt: Date.now() / 1000 - 60, // expired 60s ago
        });
        await store.saveToken(record);

        const cleaned = await store.cleanupExpired();
        expect(cleaned).toBeGreaterThanOrEqual(1);

        const result = await store.getToken("t1", "u1", "expired");
        expect(result).toBeNull();
    });
});
