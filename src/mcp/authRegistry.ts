/**
 * MCP OAuth auth registry — built once at graph startup from OrchidAgentsConfig.
 * Tracks which MCP servers require OAuth authorization.
 */
import type { OrchidAgentsConfig } from "../config/index.js";
import type { OrchidMCPServerInventory, OrchidMCPAuthMode } from "./inventory.js";

export class OrchidMCPOAuthServerInfo {
    serverName: string;
    url: string;
    agentNames: string[];
    authMode: OrchidMCPAuthMode;

    constructor({
        serverName,
        url,
        agentNames = [],
        authMode = "oauth",
    }: {
        serverName: string;
        url: string;
        agentNames?: string[];
        authMode?: OrchidMCPAuthMode;
    }) {
        this.serverName = serverName;
        this.url = url;
        this.agentNames = agentNames;
        this.authMode = authMode;
    }

    toString(): string {
        return `OrchidMCPOAuthServerInfo(serverName='${this.serverName}', url='${this.url}', agentNames=[${this.agentNames.join(", ")}])`;
    }
}

export class OrchidMCPAuthRegistry {
    private servers: Map<string, OrchidMCPOAuthServerInfo>;

    constructor() {
        this.servers = new Map();
    }

    get oauthServers(): Map<string, OrchidMCPOAuthServerInfo> {
        return this.servers;
    }

    get empty(): boolean {
        return this.servers.size === 0;
    }

    get size(): number {
        return this.servers.size;
    }

    /** Build from parsed OrchidAgentsConfig — walks all agents + children. */
    static fromConfig(config: OrchidAgentsConfig): OrchidMCPAuthRegistry {
        const registry = new OrchidMCPAuthRegistry();

        function walkAgent(agentCfg: Record<string, unknown>, parentName: string): void {
            const agentName = agentCfg.name || parentName;
            const mcpServers = agentCfg.mcpServers as Array<Record<string, unknown>> | undefined;

            if (mcpServers) {
                for (const server of mcpServers) {
                    const auth = server.auth as Record<string, string> | undefined;
                    const mode = auth?.mode ?? "none";
                    if (mode === "oauth") {
                        registry.register(
                            new OrchidMCPOAuthServerInfo({
                                serverName: server.name as string,
                                url: server.url as string,
                                agentNames: [agentName as string],
                                authMode: mode as OrchidMCPAuthMode,
                            }),
                        );
                    }
                }
            }

            const children = agentCfg.children as
                | Record<string, Record<string, unknown>>
                | null
                | undefined;
            if (children) {
                for (const childName of Object.keys(children)) {
                    walkAgent(children[childName], childName);
                }
            }
        }

        const agents = config.agents as unknown as Record<string, Record<string, unknown>>;
        for (const [agentName, agentCfg] of Object.entries(agents)) {
            walkAgent(agentCfg, agentName);
        }

        return registry;
    }

    /**
     * Build from an inventory — extracts only the OAuth entries.
     * Fast path when inventory is already computed.
     */
    static fromInventory(inventory: OrchidMCPServerInventory): OrchidMCPAuthRegistry {
        const registry = new OrchidMCPAuthRegistry();
        for (const entry of inventory.entriesWithMode("oauth")) {
            registry.register(
                new OrchidMCPOAuthServerInfo({
                    serverName: entry.serverName,
                    url: entry.url,
                    agentNames: [...entry.agentNames],
                    authMode: entry.mode,
                }),
            );
        }
        return registry;
    }

    getServer(name: string): OrchidMCPOAuthServerInfo | null {
        return this.servers.get(name) ?? null;
    }

    requiresOAuth(name: string): boolean {
        return this.servers.has(name);
    }

    register(server: OrchidMCPOAuthServerInfo): void {
        const existing = this.servers.get(server.serverName);
        if (existing) {
            const merged = new Set([...existing.agentNames, ...server.agentNames]);
            existing.agentNames = [...merged];
        } else {
            this.servers.set(server.serverName, server);
        }
    }

    entries(): OrchidMCPOAuthServerInfo[] {
        return [...this.servers.values()];
    }

    toString(): string {
        const lines = [...this.servers.entries()].map(
            ([name, info]) => `  ${name}: url=${info.url}, agents=[${info.agentNames.join(", ")}]`,
        );
        return `OrchidMCPAuthRegistry(servers=${this.servers.size}):\n${lines.join("\n")}`;
    }
}
