import { describe, it, expect } from "vitest";
import { BearerEventAuth, HMACEventAuth } from "../../src/events/index.js";

describe("BearerEventAuth", () => {
    describe("without a configured token", () => {
        const auth = new BearerEventAuth();

        it("returns true for any non-empty bearer token", async () => {
            const ok = await auth.authenticate({ authorization: "Bearer abc123" });
            expect(ok).toBe(true);
        });

        it("returns true with uppercase Authorization header", async () => {
            const ok = await auth.authenticate({ Authorization: "Bearer xyz" });
            expect(ok).toBe(true);
        });

        it("returns false for missing auth header", async () => {
            const ok = await auth.authenticate({});
            expect(ok).toBe(false);
        });

        it("returns false for empty bearer token", async () => {
            const ok = await auth.authenticate({ authorization: "Bearer " });
            expect(ok).toBe(false);
        });

        it("returns false for non-Bearer scheme", async () => {
            const ok = await auth.authenticate({ authorization: "Basic dXNlcjpwYXNz" });
            expect(ok).toBe(false);
        });
    });

    describe("with a configured token", () => {
        const auth = new BearerEventAuth("secret-token");

        it("returns true for matching token", async () => {
            const ok = await auth.authenticate({ authorization: "Bearer secret-token" });
            expect(ok).toBe(true);
        });

        it("returns false for non-matching token", async () => {
            const ok = await auth.authenticate({ authorization: "Bearer wrong-token" });
            expect(ok).toBe(false);
        });

        it("returns false for missing header even with configured token", async () => {
            const ok = await auth.authenticate({});
            expect(ok).toBe(false);
        });
    });
});

describe("HMACEventAuth", () => {
    const secret = "super-secret-key";
    const auth = new HMACEventAuth(secret);

    it("signs a payload and returns a hex string", () => {
        const sig = auth.sign("hello world");
        expect(typeof sig).toBe("string");
        expect(sig.length).toBe(64); // sha256 hex = 64 chars
    });

    it("authenticates a correctly signed payload", async () => {
        const payload = "important event data";
        const sig = auth.sign(payload);
        const ok = await auth.authenticate(payload, sig);
        expect(ok).toBe(true);
    });

    it("rejects a tampered payload", async () => {
        const sig = auth.sign("original");
        const ok = await auth.authenticate("tampered", sig);
        expect(ok).toBe(false);
    });

    it("rejects a payload with a wrong signature", async () => {
        const ok = await auth.authenticate("data", "0".repeat(64));
        expect(ok).toBe(false);
    });

    it("produces deterministic signatures", () => {
        const sig1 = auth.sign("same data");
        const sig2 = auth.sign("same data");
        expect(sig1).toBe(sig2);
    });

    it("produces different signatures for different payloads", () => {
        const sig1 = auth.sign("data A");
        const sig2 = auth.sign("data B");
        expect(sig1).not.toBe(sig2);
    });

    it("supports custom algorithm via constructor", () => {
        const sha512Auth = new HMACEventAuth(secret, "sha512");
        const sig = sha512Auth.sign("test");
        expect(sig.length).toBe(128); // sha512 hex = 128 chars
    });
});
