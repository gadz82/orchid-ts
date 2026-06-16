import { describe, it, expect } from "vitest";
import { OrchidMCPTokenRecord } from "../../src/core/mcpTokens.js";
import { OrchidMCPClientRegistration } from "../../src/core/mcpRegistration.js";

describe("OrchidMCPTokenRecord", () => {
    it("constructs with defaults", () => {
        const record = new OrchidMCPTokenRecord({
            serverName: "srv",
            tenantId: "t1",
            userId: "u1",
            accessToken: "at",
        });
        expect(record.serverName).toBe("srv");
        expect(record.tenantId).toBe("t1");
        expect(record.userId).toBe("u1");
        expect(record.accessToken).toBe("at");
        expect(record.refreshToken).toBe("");
        expect(record.expiresAt).toBe(0);
        expect(record.isExpired).toBe(false);
        expect(record.isRefreshAvailable).toBe(false);
    });

    it("detects expiry and refresh availability", () => {
        const record = new OrchidMCPTokenRecord({
            serverName: "srv",
            tenantId: "t1",
            userId: "u1",
            accessToken: "at",
            refreshToken: "rt",
            expiresAt: 1,
        });
        expect(record.isExpired).toBe(true);
        expect(record.isRefreshAvailable).toBe(true);
    });

    it("generates bearer header", () => {
        const record = new OrchidMCPTokenRecord({
            serverName: "srv",
            tenantId: "t1",
            userId: "u1",
            accessToken: "secret",
        });
        expect(record.bearerHeader).toEqual({ Authorization: "Bearer secret" });
    });
});

describe("OrchidMCPClientRegistration", () => {
    it("constructs with required fields", () => {
        const reg = new OrchidMCPClientRegistration({
            serverName: "srv",
            authorizationEndpoint: "https://auth.example.com/authorize",
            tokenEndpoint: "https://auth.example.com/token",
        });
        expect(reg.serverName).toBe("srv");
        expect(reg.isPublicClient).toBe(true);
        expect(reg.usesBasicAuth).toBe(false);
    });

    it("detects basic auth support", () => {
        const reg = new OrchidMCPClientRegistration({
            serverName: "srv",
            authorizationEndpoint: "https://a",
            tokenEndpoint: "https://t",
            tokenEndpointAuthMethodsSupported: "client_secret_basic client_secret_post",
        });
        expect(reg.usesBasicAuth).toBe(true);
    });

    it("detects public client", () => {
        const reg = new OrchidMCPClientRegistration({
            serverName: "srv",
            authorizationEndpoint: "https://a",
            tokenEndpoint: "https://t",
            clientSecret: "secret",
        });
        expect(reg.isPublicClient).toBe(false);
    });
});
