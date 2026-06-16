import { describe, it, expect } from "vitest";
import { OrchidMCPAuthRegistry, OrchidMCPOAuthServerInfo } from "../../src/mcp/authRegistry.js";
import { OrchidMCPServerInventory, OrchidMCPServerEntry } from "../../src/mcp/inventory.js";

describe("OrchidMCPOAuthServerInfo", () => {
    it("constructs with defaults", () => {
        const info = new OrchidMCPOAuthServerInfo({
            serverName: "srv",
            url: "http://localhost",
        });
        expect(info.serverName).toBe("srv");
        expect(info.url).toBe("http://localhost");
        expect(info.agentNames).toEqual([]);
        expect(info.authMode).toBe("oauth");
    });

    it("accepts custom agentNames and authMode", () => {
        const info = new OrchidMCPOAuthServerInfo({
            serverName: "srv",
            url: "http://x",
            agentNames: ["a1", "a2"],
            authMode: "passthrough",
        });
        expect(info.agentNames).toEqual(["a1", "a2"]);
        expect(info.authMode).toBe("passthrough");
    });

    it("toString includes server name", () => {
        const info = new OrchidMCPOAuthServerInfo({ serverName: "srv", url: "http://x" });
        expect(info.toString()).toContain("srv");
    });
});

describe("OrchidMCPAuthRegistry", () => {
    it("starts empty", () => {
        const registry = new OrchidMCPAuthRegistry();
        expect(registry.empty).toBe(true);
        expect(registry.size).toBe(0);
        expect(registry.entries()).toEqual([]);
    });

    it("register adds a server", () => {
        const registry = new OrchidMCPAuthRegistry();
        registry.register(new OrchidMCPOAuthServerInfo({ serverName: "s", url: "http://x" }));
        expect(registry.size).toBe(1);
        expect(registry.empty).toBe(false);
    });

    it("register merges agent names for duplicate server name", () => {
        const registry = new OrchidMCPAuthRegistry();
        registry.register(
            new OrchidMCPOAuthServerInfo({
                serverName: "s",
                url: "http://x",
                agentNames: ["a1"],
            }),
        );
        registry.register(
            new OrchidMCPOAuthServerInfo({
                serverName: "s",
                url: "http://x",
                agentNames: ["a2"],
            }),
        );
        expect(registry.size).toBe(1);
        const info = registry.getServer("s");
        expect(info!.agentNames).toContain("a1");
        expect(info!.agentNames).toContain("a2");
    });

    it("requiresOAuth checks presence", () => {
        const registry = new OrchidMCPAuthRegistry();
        registry.register(new OrchidMCPOAuthServerInfo({ serverName: "s", url: "http://x" }));
        expect(registry.requiresOAuth("s")).toBe(true);
        expect(registry.requiresOAuth("nonexistent")).toBe(false);
    });

    it("getServer returns the server info", () => {
        const registry = new OrchidMCPAuthRegistry();
        const info = new OrchidMCPOAuthServerInfo({ serverName: "srv", url: "http://srv" });
        registry.register(info);
        expect(registry.getServer("srv")).toBe(info);
        expect(registry.getServer("unknown")).toBeNull();
    });

    it("fromConfig walks all agents and only registers oauth servers", () => {
        const config = {
            agents: {
                main: {
                    name: "main",
                    mcpServers: [
                        { name: "oauth-srv", url: "http://1", auth: { mode: "oauth" } },
                        { name: "none-srv", url: "http://2", auth: { mode: "none" } },
                    ],
                    children: {
                        child: {
                            name: "child",
                            mcpServers: [
                                { name: "oauth2", url: "http://3", auth: { mode: "oauth" } },
                            ],
                        },
                    },
                },
            },
        } as any;

        const registry = OrchidMCPAuthRegistry.fromConfig(config);
        expect(registry.size).toBe(2);
        expect(registry.requiresOAuth("oauth-srv")).toBe(true);
        expect(registry.requiresOAuth("oauth2")).toBe(true);
        expect(registry.requiresOAuth("none-srv")).toBe(false);
    });

    it("fromConfig handles empty config", () => {
        const config = { agents: {} } as any;
        const registry = OrchidMCPAuthRegistry.fromConfig(config);
        expect(registry.empty).toBe(true);
    });

    it("fromInventory extracts only oauth entries", () => {
        const inventory = new OrchidMCPServerInventory();
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "oauth-srv",
                url: "http://1",
                mode: "oauth",
                agentNames: ["a1"],
            }),
        );
        inventory.put(
            new OrchidMCPServerEntry({
                serverName: "none-srv",
                url: "http://2",
                mode: "none",
                agentNames: ["a2"],
            }),
        );

        const registry = OrchidMCPAuthRegistry.fromInventory(inventory);
        expect(registry.size).toBe(1);
        expect(registry.requiresOAuth("oauth-srv")).toBe(true);
        expect(registry.requiresOAuth("none-srv")).toBe(false);
    });
});
