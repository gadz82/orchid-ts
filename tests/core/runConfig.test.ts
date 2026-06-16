import { describe, it, expect } from "vitest";
import { CONFIG_KEY_AUTH, withAuth, authFromConfig } from "../../src/core/runConfig.js";
import { OrchidAuthContext } from "../../src/core/state.js";

describe("runConfig", () => {
    it("withAuth injects auth", () => {
        const auth = new OrchidAuthContext({ accessToken: "t", tenantKey: "mytenant" });
        const config = withAuth(auth);
        expect(config["configurable"][CONFIG_KEY_AUTH]).toBe(auth);
    });

    it("withAuth injects threadId", () => {
        const config = withAuth(null, { threadId: "thread-123" });
        expect(config["configurable"]["thread_id"]).toBe("thread-123");
    });

    it("withAuth merges base config", () => {
        const base = { extra: 1, configurable: { other: "val" } };
        const auth = new OrchidAuthContext({ accessToken: "x" });
        const config = withAuth(auth, { base });
        expect(config["extra"]).toBe(1);
        expect(config["configurable"]["other"]).toBe("val");
        expect(config["configurable"][CONFIG_KEY_AUTH]).toBe(auth);
    });

    it("withAuth writes null auth as absent key", () => {
        const config = withAuth(null);
        expect(config["configurable"][CONFIG_KEY_AUTH]).toBeUndefined();
    });

    it("authFromConfig extracts auth", () => {
        const auth = new OrchidAuthContext({ accessToken: "t" });
        const config = withAuth(auth);
        const extracted = authFromConfig(config);
        expect(extracted).toBe(auth);
    });

    it("authFromConfig returns null for missing config", () => {
        expect(authFromConfig(null)).toBeNull();
        expect(authFromConfig(undefined)).toBeNull();
        expect(authFromConfig({})).toBeNull();
    });
});
