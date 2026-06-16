/**
 * MCP session warmer — drives capability cache warming at lifecycle boundaries.
 *
 * - warmUnauthenticated() runs at process startup for servers with auth.mode: none.
 * - warmForUser() runs at user-session start for passthrough + oauth servers.
 * - warmOneForUser() targets a single server (on-demand warming).
 *
 * Capabilities are cached for the process/session lifetime; the supervisor's
 * MCPDispatcher.renderCapabilities() hot path skips discovery once populated.
 */
import { OrchidAuthContext } from "../core/index.js";
import type { OrchidMCPServerInventory, OrchidMCPAuthMode } from "./inventory.js";

/** A minimal capability-aware MCP client interface. */
interface WarmableClient {
    readonly serverName?: string;

    warmCache(auth: OrchidAuthContext): Promise<void>;

    invalidateCache(): void;
}

export class OrchidWarmReport {
    warmed: string[] = [];
    skipped: string[] = [];
    failed: Record<string, string> = {};

    get ok(): boolean {
        return Object.keys(this.failed).length === 0;
    }

    get summary(): string {
        const parts: string[] = [];
        if (this.warmed.length > 0) {
            parts.push(`warmed: [${this.warmed.join(", ")}]`);
        }
        if (this.skipped.length > 0) {
            parts.push(`skipped: [${this.skipped.join(", ")}]`);
        }
        if (Object.keys(this.failed).length > 0) {
            const failEntries = Object.entries(this.failed).map(([name, err]) => `${name}(${err})`);
            parts.push(`failed: [${failEntries.join(", ")}]`);
        }
        return parts.join(" | ");
    }

    concat(other: OrchidWarmReport): void {
        this.warmed.push(...other.warmed);
        this.skipped.push(...other.skipped);
        Object.assign(this.failed, other.failed);
    }
}

const PLACEHOLDER_AUTH = new (class extends OrchidAuthContext {
    constructor() {
        super({ accessToken: "", tenantKey: "_warmer", userId: "_warmer" });
    }
})();

export class OrchidSessionWarmer {
    private inventory: OrchidMCPServerInventory;
    private agents: Record<string, unknown> | null;
    private perServerTimeout: number;
    private warmedServers: Set<string> = new Set();

    constructor(
        inventory: OrchidMCPServerInventory,
        agents: Record<string, unknown> | null = null,
        opts: { perServerTimeout?: number } = {},
    ) {
        this.inventory = inventory;
        this.agents = agents;
        this.perServerTimeout = opts.perServerTimeout ?? 20_000;
    }

    // ── Unauthenticated warm ──────────────────────────────────────

    async warmUnauthenticated(): Promise<OrchidWarmReport> {
        const report = new OrchidWarmReport();
        const entries = this.inventory.entriesWithMode("none");

        for (const entry of entries) {
            const clients = this.resolveClients(entry);
            if (clients.length === 0) {
                report.skipped.push(entry.serverName);
                continue;
            }
            for (const client of clients) {
                try {
                    await this.warmWithTimeout(client, PLACEHOLDER_AUTH, this.perServerTimeout);
                    report.warmed.push(entry.serverName);
                    this.warmedServers.add(entry.serverName);
                } catch (exc: unknown) {
                    const msg = exc instanceof Error ? exc.message : String(exc);
                    report.failed[entry.serverName] = msg;
                    console.warn(
                        "[OrchidSessionWarmer] Failed to warm unauthenticated server %s: %s",
                        entry.serverName,
                        msg,
                    );
                }
            }
        }

        return report;
    }

    // ── Per-user warm ─────────────────────────────────────────────

    async warmForUser(auth: OrchidAuthContext): Promise<OrchidWarmReport> {
        const report = new OrchidWarmReport();

        const modesToWarm: OrchidMCPAuthMode[] = ["passthrough", "oauth"];
        for (const mode of modesToWarm) {
            for (const entry of this.inventory.entriesWithMode(mode)) {
                const key = this.userKey(auth, entry.serverName);
                if (this.warmedServers.has(key)) {
                    report.skipped.push(entry.serverName);
                    continue;
                }

                const clients = this.resolveClients(entry);
                if (clients.length === 0) {
                    report.skipped.push(entry.serverName);
                    continue;
                }

                for (const client of clients) {
                    try {
                        await this.warmWithTimeout(client, auth, this.perServerTimeout);
                        report.warmed.push(entry.serverName);
                        this.warmedServers.add(key);
                    } catch (exc: unknown) {
                        const msg = exc instanceof Error ? exc.message : String(exc);
                        report.failed[entry.serverName] = msg;
                        console.warn(
                            "[OrchidSessionWarmer] Failed to warm server %s for user %s/%s: %s",
                            entry.serverName,
                            auth.tenantKey,
                            auth.userId,
                            msg,
                        );
                    }
                }
            }
        }

        return report;
    }

    async warmOneForUser(auth: OrchidAuthContext, serverName: string): Promise<OrchidWarmReport> {
        const report = new OrchidWarmReport();
        const entry = this.inventory.get(serverName);
        if (!entry) {
            report.failed[serverName] = `Unknown server '${serverName}'`;
            return report;
        }

        const key = this.userKey(auth, serverName);
        if (this.warmedServers.has(key)) {
            report.skipped.push(serverName);
            return report;
        }

        const clients = this.resolveClients(entry);
        if (clients.length === 0) {
            report.skipped.push(serverName);
            return report;
        }

        for (const client of clients) {
            try {
                await this.warmWithTimeout(client, auth, this.perServerTimeout);
                report.warmed.push(serverName);
                this.warmedServers.add(key);
            } catch (exc: unknown) {
                const msg = exc instanceof Error ? exc.message : String(exc);
                report.failed[serverName] = msg;
                console.warn(
                    "[OrchidSessionWarmer] Failed to warm server %s for user %s/%s: %s",
                    serverName,
                    auth.tenantKey,
                    auth.userId,
                    msg,
                );
            }
        }

        return report;
    }

    // ── Cache management ──────────────────────────────────────────

    isWarmed(auth: OrchidAuthContext): boolean {
        if (this.inventory.empty) return true;

        for (const entry of this.inventory.entries()) {
            if (entry.mode === "none") {
                if (!this.warmedServers.has(entry.serverName)) return false;
            } else {
                const key = this.userKey(auth, entry.serverName);
                if (!this.warmedServers.has(key)) return false;
            }
        }
        return true;
    }

    invalidateUser(auth: OrchidAuthContext): void {
        const toDelete: string[] = [];
        for (const key of this.warmedServers) {
            const userPrefix = this.userKeyPrefix(auth);
            if (key.startsWith(userPrefix)) {
                toDelete.push(key);
            }
        }
        for (const key of toDelete) {
            this.warmedServers.delete(key);
        }

        // Also invalidate in-memory caches on client instances
        this.invalidateClientsCache();
    }

    invalidateServer(serverName: string): void {
        const toDelete: string[] = [];
        for (const key of this.warmedServers) {
            if (key.endsWith(`:${serverName}`)) {
                toDelete.push(key);
            }
        }
        for (const key of toDelete) {
            this.warmedServers.delete(key);
        }

        this.invalidateClientsCache();
    }

    // ── Private helpers ───────────────────────────────────────────

    private userKey(auth: OrchidAuthContext, serverName: string): string {
        return `${this.userKeyPrefix(auth)}:${serverName}`;
    }

    private userKeyPrefix(auth: OrchidAuthContext): string {
        return `${auth.tenantKey}/${auth.userId}`;
    }

    private resolveClients(entry: { serverName: string; agentNames: string[] }): WarmableClient[] {
        const clients: WarmableClient[] = [];
        const seen = new Set<unknown>();

        if (this.agents) {
            for (const agentName of entry.agentNames) {
                const agent = this.agents[agentName] as Record<string, unknown> | undefined;
                if (agent && agent.mcpClients) {
                    const mcpClients = agent.mcpClients as unknown[];
                    for (const client of mcpClients) {
                        if (seen.has(client)) continue;
                        const wc = client as WarmableClient;
                        if (wc.serverName === entry.serverName || !wc.serverName) {
                            clients.push(wc);
                            seen.add(client);
                        }
                    }
                }
            }
        }

        return clients;
    }

    private invalidateClientsCache(): void {
        if (!this.agents) return;
        const seen = new Set<unknown>();

        for (const agent of Object.values(this.agents)) {
            const agentObj = agent as Record<string, unknown> | undefined;
            if (agentObj && agentObj.mcpClients) {
                for (const client of agentObj.mcpClients as unknown[]) {
                    if (seen.has(client)) continue;
                    seen.add(client);
                    try {
                        (client as WarmableClient).invalidateCache();
                    } catch (exc: unknown) {
                        console.debug(
                            "[OrchidSessionWarmer] Error invalidating client cache: %o",
                            exc,
                        );
                    }
                }
            }
        }
    }

    private async warmWithTimeout(
        client: WarmableClient,
        auth: OrchidAuthContext,
        timeoutMs: number,
    ): Promise<void> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const warmPromise = client.warmCache(auth);
            await Promise.race([
                warmPromise,
                new Promise<never>((_, reject) => {
                    controller.signal.addEventListener("abort", () => {
                        reject(new Error(`Warm timed out after ${timeoutMs}ms`));
                    });
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
}
