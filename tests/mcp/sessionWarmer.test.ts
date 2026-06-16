import { describe, it, expect, vi } from "vitest";
import { OrchidSessionWarmer, OrchidWarmReport } from "../../src/mcp/sessionWarmer.js";
import { OrchidMCPServerInventory, OrchidMCPServerEntry } from "../../src/mcp/inventory.js";
import { OrchidAuthContext } from "../../src/core/state.js";

function makeAuth(): OrchidAuthContext {
    return new OrchidAuthContext({ accessToken: "tok", tenantKey: "t1", userId: "u1" });
}

function makeWarmableClient(shouldFail = false): {
    serverName: string;
    warmCache: ReturnType<typeof vi.fn>;
    invalidateCache: ReturnType<typeof vi.fn>;
} {
    const makeFn = () =>
        shouldFail
            ? vi.fn().mockRejectedValue(new Error("connection refused"))
            : vi.fn().mockResolvedValue(undefined);
    return {
        serverName: "",
        warmCache: makeFn(),
        invalidateCache: vi.fn(),
    };
}

describe("OrchidWarmReport", () => {
    it("new report is ok with empty fields", () => {
        const r = new OrchidWarmReport();
        expect(r.ok).toBe(true);
        expect(r.warmed).toEqual([]);
        expect(r.skipped).toEqual([]);
        expect(r.failed).toEqual({});
    });

    it("ok is false when failed is non-empty", () => {
        const r = new OrchidWarmReport();
        r.failed["srv1"] = "timeout";
        expect(r.ok).toBe(false);
    });

    it("concat merges reports", () => {
        const r1 = new OrchidWarmReport();
        r1.warmed = ["a"];
        r1.skipped = ["b"];

        const r2 = new OrchidWarmReport();
        r2.warmed = ["c"];
        r2.failed["d"] = "err";

        r1.concat(r2);
        expect(r1.warmed).toEqual(["a", "c"]);
        expect(r1.skipped).toEqual(["b"]);
        expect(r1.failed).toEqual({ d: "err" });
    });

    it("summary includes all fields", () => {
        const r = new OrchidWarmReport();
        r.warmed = ["a"];
        r.skipped = ["b"];
        r.failed["c"] = "err";
        const s = r.summary;
        expect(s).toContain("a");
        expect(s).toContain("b");
        expect(s).toContain("c");
        expect(s).toContain("err");
    });
});

describe("OrchidSessionWarmer", () => {
    it("warmUnauthenticated warms mode:none servers", async () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "srv-none",
                url: "http://none",
                mode: "none",
                agentNames: ["a1"],
            }),
        );

        const client = makeWarmableClient();
        const agents = { a1: { mcpClients: [client] } };
        const warmer = new OrchidSessionWarmer(inventory, agents);

        const report = await warmer.warmUnauthenticated();
        expect(report.warmed).toContain("srv-none");
        expect(client.warmCache).toHaveBeenCalled();
    });

    it("warmUnauthenticated skips servers with no clients", async () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "orphan",
                url: "http://o",
                mode: "none",
                agentNames: ["no-agent"],
            }),
        );

        const warmer = new OrchidSessionWarmer(inventory, null);
        const report = await warmer.warmUnauthenticated();
        expect(report.skipped).toContain("orphan");
    });

    it("warmUnauthenticated records failures", async () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "bad-srv",
                url: "http://bad",
                mode: "none",
                agentNames: ["a1"],
            }),
        );

        const client = makeWarmableClient(true);
        client.serverName = "bad-srv";
        const agents = { a1: { mcpClients: [client] } };
        const warmer = new OrchidSessionWarmer(inventory, agents);

        const report = await warmer.warmUnauthenticated();
        expect(report.failed["bad-srv"]).toBeDefined();
        expect(report.ok).toBe(false);
    });

    it("warmForUser warms passthrough and oauth servers", async () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "srv-pt",
                url: "http://pt",
                mode: "passthrough",
                agentNames: ["a1"],
            }),
        );
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "srv-oauth",
                url: "http://oauth",
                mode: "oauth",
                agentNames: ["a1"],
            }),
        );

        const client = makeWarmableClient();
        const agents = { a1: { mcpClients: [client] } };
        const warmer = new OrchidSessionWarmer(inventory, agents);
        const auth = makeAuth();

        const report = await warmer.warmForUser(auth);
        expect(report.warmed).toContain("srv-pt");
        expect(report.warmed).toContain("srv-oauth");
    });

    it("warmForUser skips already-warmed servers", async () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "srv",
                url: "http://s",
                mode: "passthrough",
                agentNames: ["a1"],
            }),
        );

        const client = makeWarmableClient();
        const agents = { a1: { mcpClients: [client] } };
        const warmer = new OrchidSessionWarmer(inventory, agents);
        const auth = makeAuth();

        await warmer.warmForUser(auth);
        const report2 = await warmer.warmForUser(auth);
        expect(report2.skipped).toContain("srv");
    });

    it("invalidateUser clears per-user cache entries", async () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "srv",
                url: "http://s",
                mode: "passthrough",
                agentNames: ["a1"],
            }),
        );

        const client = makeWarmableClient();
        const agents = { a1: { mcpClients: [client] } };
        const warmer = new OrchidSessionWarmer(inventory, agents);
        const auth = makeAuth();

        await warmer.warmForUser(auth);
        expect(warmer.isWarmed(auth)).toBe(true);

        warmer.invalidateUser(auth);
        expect(warmer.isWarmed(auth)).toBe(false);

        // Unauthenticated cache should remain
        expect(client.invalidateCache).toHaveBeenCalled();
    });

    it("isWarmed returns true for empty inventory", () => {
        const inventory = new OrchidMCPServerInventory();
        const warmer = new OrchidSessionWarmer(inventory);
        expect(warmer.isWarmed(makeAuth())).toBe(true);
    });

    it("warmOneForUser targets a single server", async () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "srv1",
                url: "http://1",
                mode: "passthrough",
                agentNames: ["a1"],
            }),
        );
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "srv2",
                url: "http://2",
                mode: "passthrough",
                agentNames: ["a1"],
            }),
        );

        const client = makeWarmableClient();
        const agents = { a1: { mcpClients: [client] } };
        const warmer = new OrchidSessionWarmer(inventory, agents);
        const auth = makeAuth();

        const report = await warmer.warmOneForUser(auth, "srv1");
        expect(report.warmed).toContain("srv1");
    });

    it("warmOneForUser fails gracefully for unknown server", async () => {
        const inventory = new OrchidMCPServerInventory();
        const warmer = new OrchidSessionWarmer(inventory);
        const report = await warmer.warmOneForUser(makeAuth(), "unknown");
        expect(report.failed["unknown"]).toBeDefined();
    });
});
