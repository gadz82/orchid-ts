import { describe, it, expect } from "vitest";
import { OrchidAuthContext } from "../../src/core/state.js";

describe("OrchidAuthContext", () => {
    it("constructs with defaults", () => {
        const ctx = new OrchidAuthContext({ accessToken: "token123" });
        expect(ctx.accessToken).toBe("token123");
        expect(ctx.tenantKey).toBe("default");
        expect(ctx.userId).toBe("");
        expect(ctx.expiresAt).toBe(0);
        expect(ctx.isExpired).toBe(false);
        expect(ctx.roles.size).toBe(0);
    });

    it("constructs with all fields", () => {
        const ctx = new OrchidAuthContext({
            accessToken: "tok",
            tenantKey: "mytenant",
            userId: "user-1",
            expiresAt: Date.now() / 1000 + 3600,
            extra: { x: 1 },
            roles: ["admin", "viewer"],
        });
        expect(ctx.tenantKey).toBe("mytenant");
        expect(ctx.userId).toBe("user-1");
        expect(ctx.isExpired).toBe(false);
        expect(ctx.roles.size).toBe(2);
        expect(ctx.extra).toEqual({ x: 1 });
    });

    it("detects expired token", () => {
        const ctx = new OrchidAuthContext({
            accessToken: "tok",
            expiresAt: 1, // epoch 1 = expired
        });
        expect(ctx.isExpired).toBe(true);
    });

    it("generates bearer header", () => {
        const ctx = new OrchidAuthContext({ accessToken: "secret" });
        expect(ctx.bearerHeader).toEqual({ Authorization: "Bearer secret" });
    });

    it("round-trips through storage dict", () => {
        const original = new OrchidAuthContext({
            accessToken: "orig-token",
            tenantKey: "t1",
            userId: "u1",
            extra: { key: "value" },
            roles: ["admin"],
        });
        const stored = original.toStorageDict();
        const restored = OrchidAuthContext.fromStorageDict({
            accessToken: "new-token",
            expiresAt: 999,
            state: stored,
        });
        expect(restored.tenantKey).toBe("t1");
        expect(restored.userId).toBe("u1");
        expect(restored.accessToken).toBe("new-token");
        expect(restored.expiresAt).toBe(999);
        expect(restored.roles.has("admin")).toBe(true);
    });

    it("samePrincipal checks tenant + user only", () => {
        const a = new OrchidAuthContext({ accessToken: "a", tenantKey: "t", userId: "u" });
        const b = new OrchidAuthContext({
            accessToken: "b",
            tenantKey: "t",
            userId: "u",
            roles: ["admin"],
        });
        expect(a.samePrincipal(b)).toBe(true);
        expect(a.equals(b)).toBe(true);
    });

    it("samePrincipal returns false for different users", () => {
        const a = new OrchidAuthContext({ accessToken: "a", tenantKey: "t", userId: "u1" });
        const b = new OrchidAuthContext({ accessToken: "b", tenantKey: "t", userId: "u2" });
        expect(a.samePrincipal(b)).toBe(false);
    });

    it("has a string representation", () => {
        const ctx = new OrchidAuthContext({ accessToken: "t", userId: "me" });
        const str = ctx.toString();
        expect(str).toContain("OrchidAuthContext");
        expect(str).toContain("me");
    });
});
