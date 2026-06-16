import { describe, it, expect } from "vitest";
import {
    OrchidGuardrailAction,
    OrchidGuardrailDirection,
    OrchidGuardrailResult,
    OrchidGuardrailChain,
    OrchidGuardrail,
} from "../../src/core/guardrails.js";
import type { OrchidGuardrailContext } from "../../src/core/guardrails.js";

class NoopGuardrail extends OrchidGuardrail {
    get name() {
        return "noop";
    }
    async check() {
        return OrchidGuardrailResult.passed("noop");
    }
}

class BlockGuardrail extends OrchidGuardrail {
    get name() {
        return "blocker";
    }
    async check() {
        return new OrchidGuardrailResult({
            triggered: true,
            action: OrchidGuardrailAction.BLOCK,
            guardrailName: "blocker",
            message: "blocked!",
        });
    }
}

class RedactGuardrail extends OrchidGuardrail {
    get name() {
        return "redactor";
    }
    async check() {
        return new OrchidGuardrailResult({
            triggered: true,
            action: OrchidGuardrailAction.REDACT,
            guardrailName: "redactor",
            redactedContent: "sanitised",
        });
    }
}

const ctx: OrchidGuardrailContext = {
    direction: OrchidGuardrailDirection.INPUT,
    agentName: "test",
    tenantKey: "t1",
    userId: "u1",
    chatId: "c1",
    metadata: {},
};

describe("OrchidGuardrail", () => {
    it("OrchidGuardrailResult.passed() factory", () => {
        const r = OrchidGuardrailResult.passed("g1");
        expect(r.triggered).toBe(false);
        expect(r.action).toBe(OrchidGuardrailAction.ALLOW);
        expect(r.guardrailName).toBe("g1");
    });

    it("blocked property on result", () => {
        const r = new OrchidGuardrailResult({
            triggered: true,
            action: OrchidGuardrailAction.BLOCK,
        });
        expect(r.blocked).toBe(true);
        const r2 = new OrchidGuardrailResult({
            triggered: false,
            action: OrchidGuardrailAction.ALLOW,
        });
        expect(r2.blocked).toBe(false);
    });

    it("empty chain returns passed", async () => {
        const chain = new OrchidGuardrailChain();
        const result = await chain.evaluate("hello", ctx);
        expect(result.triggered).toBe(false);
    });

    it("chain short-circuits on block", async () => {
        const chain = new OrchidGuardrailChain([
            new NoopGuardrail(),
            new BlockGuardrail(),
            new RedactGuardrail(),
        ]);
        const result = await chain.evaluate("hello", ctx);
        expect(result.action).toBe(OrchidGuardrailAction.BLOCK);
        expect(result.guardrailName).toBe("blocker");
    });

    it("chain passes redacted content through", async () => {
        const chain = new OrchidGuardrailChain([new RedactGuardrail()]);
        const result = await chain.evaluate("secret info", ctx);
        expect(result.action).toBe(OrchidGuardrailAction.REDACT);
        expect(result.redactedContent).toBe("sanitised");
    });
});

describe("OrchidGuardrailAction", () => {
    it("has all expected values", () => {
        expect(OrchidGuardrailAction.ALLOW).toBe("allow");
        expect(OrchidGuardrailAction.BLOCK).toBe("block");
        expect(OrchidGuardrailAction.REDACT).toBe("redact");
        expect(OrchidGuardrailAction.WARN).toBe("warn");
        expect(OrchidGuardrailAction.LOG).toBe("log");
    });
});
