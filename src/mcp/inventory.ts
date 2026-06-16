/**
 * MCP server inventory — scans all agents + children from config,
 * dedupes by (serverName, url). Warns on conflicting auth modes.
 */
import type { OrchidAgentsConfig, OrchidAgentConfig } from "../config/index.js";

export type OrchidMCPAuthMode = "none" | "passthrough" | "oauth";

export class MCPToolAnnotations {
    readOnlyHint: boolean | null = null;
    idempotentHint: boolean | null = null;
    destructiveHint: boolean | null = null;
    openWorldHint: boolean | null = null;

    constructor(opts?: {
        readOnlyHint?: boolean | null;
        idempotentHint?: boolean | null;
        destructiveHint?: boolean | null;
        openWorldHint?: boolean | null;
    }) {
        this.readOnlyHint = opts?.readOnlyHint ?? null;
        this.idempotentHint = opts?.idempotentHint ?? null;
        this.destructiveHint = opts?.destructiveHint ?? null;
        this.openWorldHint = opts?.openWorldHint ?? null;
    }

    static fromRaw(raw: unknown): MCPToolAnnotations | null {
        if (raw === null || raw === undefined) return null;
        try {
            const pick = (keyCamel: string, keySnake: string): boolean | null => {
                let value: unknown;
                if (typeof raw === "object" && raw !== null) {
                    value = (raw as Record<string, unknown>)[keyCamel];
                    if (value === undefined || value === null) {
                        value = (raw as Record<string, unknown>)[keySnake];
                    }
                }
                if (value === undefined || value === null) return null;
                return Boolean(value);
            };
            return new MCPToolAnnotations({
                readOnlyHint: pick("readOnlyHint", "read_only_hint"),
                idempotentHint: pick("idempotentHint", "idempotent_hint"),
                destructiveHint: pick("destructiveHint", "destructive_hint"),
                openWorldHint: pick("openWorldHint", "open_world_hint"),
            });
        } catch {
            console.debug("[MCPToolAnnotations] Could not parse %o", raw);
            return null;
        }
    }
}

const INVENTORY_KEY_SEPARATOR = "\x00";

function makeKey(name: string, url: string): string {
    return `${name}${INVENTORY_KEY_SEPARATOR}${url}`;
}

function serializeEntry(entry: OrchidMCPServerEntry): string {
    return JSON.stringify({
        n: entry.serverName,
        u: entry.url,
        m: entry.mode,
        a: entry.agentNames.slice().sort(),
    });
}

export class OrchidMCPServerEntry {
    serverName: string;
    url: string;
    mode: OrchidMCPAuthMode;
    agentNames: string[];
    private sig: string;

    constructor({
        serverName,
        url,
        mode = "none",
        agentNames = [],
    }: {
        serverName: string;
        url: string;
        mode?: OrchidMCPAuthMode;
        agentNames?: string[];
    }) {
        this.serverName = serverName;
        this.url = url;
        this.mode = mode;
        this.agentNames = agentNames;
        this.sig = "";
    }

    get canonicalKey(): string {
        return makeKey(this.serverName, this.url);
    }

    /** Stable hash for Map indexing — computed lazily. */
    get signature(): string {
        if (!this.sig) {
            this.sig = serializeEntry(this);
        }
        return this.sig;
    }

    addAgent(agentName: string): void {
        if (!this.agentNames.includes(agentName)) {
            this.agentNames.push(agentName);
            this.sig = "";
        }
    }

    mergeAgentNames(other: string[]): void {
        for (const name of other) {
            if (!this.agentNames.includes(name)) {
                this.agentNames.push(name);
            }
        }
        if (other.length > 0) {
            this.sig = "";
        }
    }

    toString(): string {
        return `OrchidMCPServerEntry(serverName='${this.serverName}', url='${this.url}', mode=${this.mode}, agentNames=[${this.agentNames.join(", ")}])`;
    }
}

export class OrchidMCPServerInventory {
    private store: Map<string, OrchidMCPServerEntry>;

    constructor(entries: Map<string, OrchidMCPServerEntry> | null = null) {
        this.store = entries ?? new Map();
    }

    get empty(): boolean {
        return this.store.size === 0;
    }

    get size(): number {
        return this.store.size;
    }

    static fromConfig(config: OrchidAgentsConfig): OrchidMCPServerInventory {
        const inventory = new OrchidMCPServerInventory();

        function walkAgent(agentCfg: OrchidAgentConfig, parentName: string): void {
            const agentName = agentCfg.name || parentName;

            for (const serverCfg of agentCfg.mcpServers) {
                const entry = new OrchidMCPServerEntry({
                    serverName: serverCfg.name,
                    url: serverCfg.url,
                    mode: serverCfg.auth.mode as OrchidMCPAuthMode,
                    agentNames: [agentName],
                });

                const key = entry.canonicalKey;
                const existing = inventory.store.get(key);
                if (existing) {
                    if (existing.mode !== entry.mode) {
                        console.warn(
                            '[OrchidMCPServerInventory] Agent %s declares MCP server "%s" with auth mode "%s", ' +
                                'but agent(s) %s already declared it with mode "%s". ' +
                                "Using first-seen mode (%s).",
                            agentName,
                            serverCfg.name,
                            entry.mode,
                            existing.agentNames.join(", "),
                            existing.mode,
                            existing.mode,
                        );
                    }
                    existing.addAgent(agentName);
                } else {
                    inventory.store.set(key, entry);
                }
            }

            const children = agentCfg.children;
            if (children) {
                for (const childName of Object.keys(children)) {
                    walkAgent(children[childName], childName);
                }
            }
        }

        for (const [agentName, agentCfg] of Object.entries(config.agents)) {
            walkAgent(agentCfg, agentName);
        }

        return inventory;
    }

    put(entry: OrchidMCPServerEntry): void {
        const key = entry.canonicalKey;
        const existing = this.store.get(key);
        if (existing) {
            existing.mergeAgentNames(entry.agentNames);
        } else {
            this.store.set(key, entry);
        }
    }

    entries(): OrchidMCPServerEntry[] {
        return [...this.store.values()];
    }

    entriesWithMode(mode: OrchidMCPAuthMode): OrchidMCPServerEntry[] {
        return this.entries().filter((e) => e.mode === mode);
    }

    get(name: string): OrchidMCPServerEntry | null {
        for (const entry of this.store.values()) {
            if (entry.serverName === name) return entry;
        }
        return null;
    }

    // ── Builder from config ─────────────────────────────────────

    /**
     * Map server entries to instantiated agent objects.
     * Returns array of {agent, serverEntry} pairs.
     */
    clientsFor(
        entry: OrchidMCPServerEntry,
        agents: Record<string, unknown>,
    ): Array<{ agent: unknown; serverEntry: OrchidMCPServerEntry }> {
        const result: Array<{ agent: unknown; serverEntry: OrchidMCPServerEntry }> = [];
        for (const agentName of entry.agentNames) {
            const agent = agents[agentName];
            if (agent !== undefined) {
                result.push({ agent, serverEntry: entry });
            }
        }
        return result;
    }
}
