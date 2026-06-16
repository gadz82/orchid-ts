import { describe, it, expect } from "vitest";
import { extractUserQuery } from "../../src/core/helpers.js";
import type { OrchidAgentState } from "../../src/core/state.js";
import { validateIdentityConformance } from "../../src/core/identityConformance.js";
import { OrchidAuthContext } from "../../src/core/state.js";

describe("extractUserQuery", () => {
    it("extracts last human message", () => {
        const state: OrchidAgentState = {
            messages: [
                { type: "human", content: "hello" },
                { type: "ai", content: "hi there" },
                { type: "human", content: "help" },
            ],
            chatId: "c1",
            activeAgents: [],
            mcpContext: {},
            ragContext: {},
            finalResponse: null,
            skillInstructions: {},
            _hasOutputGuardrails: false,
        };
        expect(extractUserQuery(state)).toBe("help");
    });

    it("returns empty for no messages", () => {
        const state: OrchidAgentState = {
            messages: [],
            chatId: "c1",
            activeAgents: [],
            mcpContext: {},
            ragContext: {},
            finalResponse: null,
            skillInstructions: {},
            _hasOutputGuardrails: false,
        };
        expect(extractUserQuery(state)).toBe("");
    });
});

describe("validateIdentityConformance", () => {
    it("validates a complete auth context", () => {
        const auth = new OrchidAuthContext({
            accessToken: "t",
            tenantKey: "t1",
            userId: "u1",
        });
        const result = validateIdentityConformance(auth);
        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
    });

    it("detects missing fields", () => {
        const auth = new OrchidAuthContext({ accessToken: "" });
        const result = validateIdentityConformance(auth);
        expect(result.valid).toBe(false);
        expect(result.missing).toContain("access_token");
    });

    it("checks required extra claims", () => {
        const auth = new OrchidAuthContext({
            accessToken: "t",
            tenantKey: "t1",
            userId: "u1",
            extra: { custom: "yes" },
        });
        const result = validateIdentityConformance(auth, ["custom"]);
        expect(result.valid).toBe(true);

        const result2 = validateIdentityConformance(auth, ["missing_claim"]);
        expect(result2.valid).toBe(false);
        expect(result2.missing).toContain("missing_claim");
    });
});
