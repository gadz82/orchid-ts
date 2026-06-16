import { describe, it, expect } from "vitest";
import { OrchidMCPServerEntry, OrchidMCPServerInventory } from "../../src/mcp/inventory.js";

function makeEntry(opts?: {
    serverName?: string;
    url?: string;
    mode?: "none" | "passthrough" | "oauth";
    agentNames?: string[];
}) {
    return new OrchidMCPServerEntry({
        serverName: opts?.serverName ?? "test-server",
        url: opts?.url ?? "http://localhost:9000",
        mode: opts?.mode ?? "none",
        agentNames: opts?.agentNames ?? ["test-agent"],
    });
}

describe("OrchidMCPServerEntry", () => {
    it("constructs with all properties", () => {
        const entry = new OrchidMCPServerEntry({
            serverName: "my-server",
            url: "https://mcp.example.com",
            mode: "oauth",
            agentNames: ["agent1", "agent2"],
        });
        expect(entry.serverName).toBe("my-server");
        expect(entry.url).toBe("https://mcp.example.com");
        expect(entry.mode).toBe("oauth");
        expect(entry.agentNames).toEqual(["agent1", "agent2"]);
    });

    it("defaults mode to none and agentNames to empty", () => {
        const entry = new OrchidMCPServerEntry({
            serverName: "s",
            url: "http://localhost",
        });
        expect(entry.mode).toBe("none");
        expect(entry.agentNames).toEqual([]);
    });

    it("canonicalKey is deterministic", () => {
        const e1 = makeEntry({ serverName: "s1", url: "http://a" });
        const e2 = makeEntry({ serverName: "s1", url: "http://a" });
        expect(e1.canonicalKey).toBe(e2.canonicalKey);
    });

    it("canonicalKey differs for different urls", () => {
        const e1 = makeEntry({ serverName: "s", url: "http://a" });
        const e2 = makeEntry({ serverName: "s", url: "http://b" });
        expect(e1.canonicalKey).not.toBe(e2.canonicalKey);
    });

    it("addAgent appends if not present", () => {
        const entry = makeEntry({ agentNames: ["a"] });
        entry.addAgent("b");
        expect(entry.agentNames).toEqual(["a", "b"]);
    });

    it("addAgent does not duplicate", () => {
        const entry = makeEntry({ agentNames: ["a"] });
        entry.addAgent("a");
        expect(entry.agentNames).toEqual(["a"]);
    });

    it("mergeAgentNames adds unique names", () => {
        const entry = makeEntry({ agentNames: ["a"] });
        entry.mergeAgentNames(["b", "a", "c"]);
        expect(entry.agentNames).toEqual(["a", "b", "c"]);
    });

    it("signature changes when agents are added", () => {
        const entry = makeEntry({ agentNames: ["a"] });
        const sig1 = entry.signature;
        entry.addAgent("b");
        expect(entry.signature).not.toBe(sig1);
    });

    it("toString includes server name and url", () => {
        const entry = makeEntry({ serverName: "srv", url: "http://x" });
        expect(entry.toString()).toContain("srv");
        expect(entry.toString()).toContain("http://x");
    });
});

describe("OrchidMCPServerInventory", () => {
    it("constructs empty by default", () => {
        const inv = new OrchidMCPServerInventory();
        expect(inv.empty).toBe(true);
        expect(inv.size).toBe(0);
        expect(inv.entries()).toEqual([]);
    });

    it("put adds entry", () => {
        const inv = new OrchidMCPServerInventory();
        inv.put(makeEntry());
        expect(inv.size).toBe(1);
    });

    it("put merges agent names for duplicate key", () => {
        const inv = new OrchidMCPServerInventory();
        inv.put(makeEntry({ serverName: "s", url: "http://x", agentNames: ["a"] }));
        inv.put(makeEntry({ serverName: "s", url: "http://x", agentNames: ["b"] }));
        expect(inv.size).toBe(1);
        expect(inv.entries()[0].agentNames).toContain("a");
        expect(inv.entries()[0].agentNames).toContain("b");
    });

    it("entriesWithMode filters by auth mode", () => {
        const inv = new OrchidMCPServerInventory();
        inv.put(makeEntry({ serverName: "a", url: "http://1", mode: "none" }));
        inv.put(makeEntry({ serverName: "b", url: "http://2", mode: "oauth" }));
        inv.put(makeEntry({ serverName: "c", url: "http://3", mode: "passthrough" }));

        expect(inv.entriesWithMode("none")).toHaveLength(1);
        expect(inv.entriesWithMode("oauth")).toHaveLength(1);
        expect(inv.entriesWithMode("passthrough")).toHaveLength(1);
    });

    it("get returns entry by server name", () => {
        const inv = new OrchidMCPServerInventory();
        inv.put(makeEntry({ serverName: "srv1", url: "http://1" }));
        inv.put(makeEntry({ serverName: "srv2", url: "http://2" }));
        expect(inv.get("srv1")).not.toBeNull();
        expect(inv.get("nonexistent")).toBeNull();
    });

    it("fromConfig walks all agents and children", () => {
        const config = {
            agents: {
                main: {
                    name: "main",
                    mcpServers: [{ name: "srv1", url: "http://1", auth: { mode: "none" } }],
                    children: {
                        child: {
                            name: "child",
                            mcpServers: [
                                { name: "srv2", url: "http://2", auth: { mode: "oauth" } },
                            ],
                        },
                    },
                },
                standalone: {
                    name: "standalone",
                    mcpServers: [{ name: "srv1", url: "http://1", auth: { mode: "none" } }],
                },
            },
        } as any;
        const inv = OrchidMCPServerInventory.fromConfig(config);
        expect(inv.size).toBe(2);
        const srv1 = inv.get("srv1");
        expect(srv1).not.toBeNull();
        expect(srv1!.agentNames).toContain("main");
        expect(srv1!.agentNames).toContain("standalone");
    });

    it("fromConfig handles agents without mcpServers", () => {
        const config = { agents: { a: { name: "a", mcpServers: [] } } } as any;
        const inv = OrchidMCPServerInventory.fromConfig(config);
        expect(inv.empty).toBe(true);
    });

    it("clientsFor returns agent-server pairs", () => {
        const inv = new OrchidMCPServerInventory();
        const entry = makeEntry({ agentNames: ["a1", "a2"] });
        const agents = { a1: { name: "a1" }, a2: { name: "a2" } };
        const clients = inv.clientsFor(entry, agents);
        expect(clients).toHaveLength(2);
        expect(clients[0].agent).toBe(agents.a1);
        expect(clients[1].agent).toBe(agents.a2);
    });
});
