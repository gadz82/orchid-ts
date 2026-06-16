import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OrchidSQLiteMCPGatewayStateStore } from "../../src/persistence/mcpGatewayStateSqlite.js";

let store: OrchidSQLiteMCPGatewayStateStore;

beforeEach(async () => {
    store = new OrchidSQLiteMCPGatewayStateStore(":memory:");
    await store.initDb();
});

afterEach(async () => {
    await store.close();
});

describe("OrchidSQLiteMCPGatewayStateStore - Clients", () => {
    it("registers and retrieves a client", async () => {
        const client = await store.register({
            clientId: "abc-client",
            redirectUris: ["https://app.example.com/callback"],
            grantTypes: ["authorization_code"],
        });
        expect(client.clientId).toBe("abc-client");

        const retrieved = await store.get("abc-client");
        expect(retrieved).not.toBeNull();
        expect(retrieved!.clientId).toBe("abc-client");
        expect(retrieved!.redirectUris).toEqual(["https://app.example.com/callback"]);
    });

    it("returns null for missing client", async () => {
        const result = await store.get("no-such-client");
        expect(result).toBeNull();
    });
});

describe("OrchidSQLiteMCPGatewayStateStore - Auth Codes", () => {
    it("puts and retrieves an auth code by upstream state", async () => {
        await store.put({
            code: "auth-code-1",
            clientId: "abc-client",
            redirectUri: "https://app.example.com/callback",
            upstreamState: "state-123",
            scope: "read write",
            expiresAt: Date.now() / 1000 + 600,
            consumed: false,
        });

        const retrieved = await store.getByUpstreamState("state-123");
        expect(retrieved).not.toBeNull();
        expect(retrieved!.code).toBe("auth-code-1");
        expect(retrieved!.clientId).toBe("abc-client");
    });

    it("updates an auth code", async () => {
        await store.put({
            code: "auth-code-2",
            clientId: "abc-client",
            redirectUri: "https://app.example.com/callback",
            upstreamState: "state-456",
            expiresAt: Date.now() / 1000 + 600,
            consumed: false,
        });

        await store.update("auth-code-2", {
            idpAccessToken: "idp-tok",
            idpRefreshToken: "idp-ref",
        });

        const code = await store.getByUpstreamState("state-456");
        expect(code!.idpAccessToken).toBe("idp-tok");
        expect(code!.idpRefreshToken).toBe("idp-ref");
    });

    it("consumes an auth code (deletes it)", async () => {
        await store.put({
            code: "auth-code-3",
            clientId: "abc-client",
            redirectUri: "https://app.example.com/callback",
            upstreamState: "state-789",
            expiresAt: Date.now() / 1000 + 600,
            consumed: false,
        });

        const consumed = await store.consume("auth-code-3");
        expect(consumed).not.toBeNull();
        expect(consumed!.consumed).toBe(true);

        // Should be gone now
        const gone = await store.getByUpstreamState("state-789");
        expect(gone).toBeNull();
    });

    it("returns null for missing upstream state", async () => {
        const result = await store.getByUpstreamState("no-state");
        expect(result).toBeNull();
    });
});

describe("OrchidSQLiteMCPGatewayStateStore - Tokens", () => {
    it("issues, retrieves, and revokes a token", async () => {
        const issued = await store.issue({
            accessToken: "at-123",
            refreshToken: "rt-456",
            clientId: "abc-client",
            userId: "u1",
            tenantId: "t1",
            scope: "read",
            expiresAt: Date.now() / 1000 + 3600,
        });
        expect(issued.accessToken).toBe("at-123");

        const byAccess = await store.getByAccessToken("at-123");
        expect(byAccess).not.toBeNull();
        expect(byAccess!.refreshToken).toBe("rt-456");

        const byRefresh = await store.getByRefreshToken("rt-456");
        expect(byRefresh).not.toBeNull();

        const revoked = await store.revoke("at-123");
        expect(revoked).toBe(true);

        const gone = await store.getByAccessToken("at-123");
        expect(gone).toBeNull();
    });
});
