/**
 * StreamableHttpMCPClient — production MCP client implementing
 * OrchidMCPToolCaller + discoverable + cacheable interfaces.
 *
 * Supports three auth modes:
 *   none        — no auth headers
 *   passthrough — forwards OrchidAuthContext bearer token
 *   oauth       — per-user tokens from OrchidMCPTokenStore with auto-refresh
 *
 * Uses @modelcontextprotocol/sdk for MCP protocol operations.
 * Catches ALL errors at server boundaries — one failing tool/server never crashes the caller.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { OrchidAuthContext } from "../core/state.js";
import type { OrchidMCPToolCaller } from "../core/mcpInterfaces.js";
import { OrchidMCPToolResult } from "../core/mcpResult.js";
import type { MCPContentBlock } from "../core/mcpResult.js";
import { OrchidMCPAuthRequiredError } from "../core/mcpErrors.js";
import { OrchidMCPTokenRecord } from "../core/mcpTokens.js";
import type { OrchidMCPTokenStore } from "../core/mcpTokens.js";
import type { OrchidMCPClientRegistrationStore } from "../core/mcpRegistration.js";

// ── Types ─────────────────────────────────────────────────────────

type AuthMode = "none" | "passthrough" | "oauth";

interface ClientOptions {
    url: string;
    serverType?: string;
    transport?: string;
    serverName?: string;
    authMode?: AuthMode;
    tokenStore?: OrchidMCPTokenStore | null;
    registrationStore?: OrchidMCPClientRegistrationStore | null;
    allowedPassthroughHosts?: string[];
}

interface CachedCapabilities {
    tools: Array<Record<string, unknown>>;
    prompts: Array<Record<string, unknown>>;
    resources: Array<Record<string, unknown>>;
    fetchedAt: number;
}

const CLIENT_INFO = {
    name: "orchid-mcp-client",
    version: "1.0.0",
};

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const TOKEN_EXPIRY_BUFFER_SEC = 30; // refresh if token expires within 30s

// ── Auth helper ───────────────────────────────────────────────────

function modeFromEntry(authMode?: string): AuthMode {
    if (authMode === "passthrough") return "passthrough";
    if (authMode === "oauth") return "oauth";
    return "none";
}

function buildBasicAuth(clientId: string, clientSecret: string): string {
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    return `Basic ${encoded}`;
}

async function httpPost(
    url: string,
    body: Record<string, string>,
    headers?: Record<string, string>,
): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            ...(headers ?? {}),
        },
        body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
        let errorBody = "";
        try {
            errorBody = await response.text();
        } catch {
            // ignore
        }
        throw new Error(
            `Token request failed (HTTP ${response.status}): ${errorBody.substring(0, 200)}`,
        );
    }

    return (await response.json()) as Record<string, unknown>;
}

// ── Main class ────────────────────────────────────────────────────

export class StreamableHttpMCPClient implements OrchidMCPToolCaller {
    readonly url: string;
    readonly serverType: string;
    readonly transportType: string;
    readonly serverName: string;
    readonly authMode: AuthMode;
    readonly tokenStore: OrchidMCPTokenStore | null;
    readonly registrationStore: OrchidMCPClientRegistrationStore | null;
    readonly allowedPassthroughHosts: string[];

    // Transport state
    private transport: StreamableHTTPClientTransport | null = null;
    private client: Client | null = null;
    private connected = false;
    private lastAuthSig = "";

    // Capability cache
    private capabilities: CachedCapabilities | null = null;

    constructor(opts: ClientOptions) {
        this.url = opts.url;
        this.serverType = opts.serverType ?? "local";
        this.transportType = opts.transport ?? "streamable_http";
        this.serverName = opts.serverName ?? "unknown";
        this.authMode = modeFromEntry(opts.authMode);
        this.tokenStore = opts.tokenStore ?? null;
        this.registrationStore = opts.registrationStore ?? null;
        this.allowedPassthroughHosts = opts.allowedPassthroughHosts ?? [];
    }

    // ── OrchidMCPToolCaller ────────────────────────────────────────

    get serverUrl(): string {
        return this.url;
    }

    get cachedTools(): Array<Record<string, unknown>> {
        return this.capabilities?.tools ?? [];
    }

    // ── Discovery methods ──────────────────────────────────────────

    get cachedPrompts(): Array<Record<string, unknown>> {
        return this.capabilities?.prompts ?? [];
    }

    get cachedResources(): Array<Record<string, unknown>> {
        return this.capabilities?.resources ?? [];
    }

    get isCacheWarm(): boolean {
        return this.capabilities !== null;
    }

    async callTool(
        toolName: string,
        arguments_: Record<string, unknown>,
        auth: OrchidAuthContext,
        opts?: { timeout?: number },
    ): Promise<OrchidMCPToolResult> {
        try {
            const client = await this.getConnectedClient(auth, opts?.timeout);
            const result = await client.callTool({
                name: toolName,
                arguments: arguments_,
            });

            // Normalise content blocks
            const rawContent = result.content as Array<Record<string, unknown>> | undefined;
            const content =
                rawContent?.map((item: Record<string, unknown>) => {
                    const block: Record<string, unknown> = { type: item.type ?? "text" };
                    if (item.type === "text" && "text" in item) block.text = item.text;
                    if (item.type === "resource" && "resource" in item)
                        block.resource = item.resource;
                    if (item.type === "image" && "data" in item) {
                        block.data = item.data;
                        block.mimeType = item.mimeType;
                    }
                    if ("annotations" in item) block.annotations = item.annotations;
                    return block;
                }) ?? [];

            return new OrchidMCPToolResult(content as MCPContentBlock[], result.isError === true);
        } catch (exc: unknown) {
            if (exc instanceof OrchidMCPAuthRequiredError) throw exc;

            const msg = exc instanceof Error ? exc.message : String(exc);
            console.warn(
                '[MCP Client][%s] Tool call "%s" failed: %s',
                this.serverName,
                toolName,
                msg,
            );
            return new OrchidMCPToolResult(
                [{ type: "text", text: `[Tool error] ${toolName}: ${msg}` }],
                true,
            );
        }
    }

    async listTools(auth: OrchidAuthContext): Promise<Array<Record<string, unknown>>> {
        try {
            const client = await this.getConnectedClient(auth);
            const result = await client.listTools();
            const tools = result.tools ?? [];
            return this.paginate(() => client.listTools(), tools);
        } catch (exc: unknown) {
            console.warn("[MCP Client][%s] listTools failed: %o", this.serverName, exc);
            return [];
        }
    }

    // ── Cache management ───────────────────────────────────────────

    async listPrompts(auth: OrchidAuthContext): Promise<Array<Record<string, unknown>>> {
        try {
            const client = await this.getConnectedClient(auth);
            const result = await client.listPrompts();
            const prompts = result.prompts ?? [];
            return this.paginate(() => client.listPrompts(), prompts);
        } catch (exc: unknown) {
            console.warn("[MCP Client][%s] listPrompts failed: %o", this.serverName, exc);
            return [];
        }
    }

    async listResources(auth: OrchidAuthContext): Promise<Array<Record<string, unknown>>> {
        try {
            const client = await this.getConnectedClient(auth);
            const result = await client.listResources();
            const resources = result.resources ?? [];
            return this.paginate(() => client.listResources(), resources);
        } catch (exc: unknown) {
            console.warn("[MCP Client][%s] listResources failed: %o", this.serverName, exc);
            return [];
        }
    }

    async getPrompt(
        name: string,
        arguments_: Record<string, string>,
        auth: OrchidAuthContext,
    ): Promise<Array<Record<string, unknown>>> {
        try {
            const client = await this.getConnectedClient(auth);
            const result = await client.getPrompt({ name, arguments: arguments_ });
            const messages = result.messages ?? [];
            return messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
            }));
        } catch (exc: unknown) {
            console.warn('[MCP Client][%s] getPrompt "%s" failed: %o', this.serverName, name, exc);
            return [];
        }
    }

    async readResource(uri: string, auth: OrchidAuthContext): Promise<string> {
        try {
            const client = await this.getConnectedClient(auth);
            const result = await client.readResource({ uri });
            if (result.contents && result.contents.length > 0) {
                return result.contents
                    .map((c) => {
                        if (typeof c === "string") return c;
                        if (c && typeof c === "object" && "text" in c)
                            return (c as Record<string, unknown>).text as string;
                        if (c && typeof c === "object" && "blob" in c) {
                            return Buffer.from(
                                (c as Record<string, unknown>).blob as string,
                                "base64",
                            ).toString("utf-8");
                        }
                        return String(c);
                    })
                    .filter(Boolean)
                    .join("\n");
            }
        } catch (exc: unknown) {
            console.warn(
                '[MCP Client][%s] readResource "%s" failed: %o',
                this.serverName,
                uri,
                exc,
            );
        }
        return "";
    }

    async warmCache(auth: OrchidAuthContext): Promise<void> {
        try {
            const client = await this.getConnectedClient(auth);

            let tools: Array<Record<string, unknown>> = [];
            let prompts: Array<Record<string, unknown>> = [];
            let resources: Array<Record<string, unknown>> = [];

            try {
                const toolsResult = await client.listTools();
                tools = toolsResult.tools ?? [];
                tools = await this.paginate(() => client.listTools(), tools);
            } catch (exc: unknown) {
                console.warn(
                    "[MCP Client][%s] warmCache listTools failed: %o",
                    this.serverName,
                    exc,
                );
            }

            try {
                const promptsResult = await client.listPrompts();
                prompts = promptsResult.prompts ?? [];
                prompts = await this.paginate(() => client.listPrompts(), prompts);
            } catch (exc: unknown) {
                console.warn(
                    "[MCP Client][%s] warmCache listPrompts failed: %o",
                    this.serverName,
                    exc,
                );
            }

            try {
                const resourcesResult = await client.listResources();
                resources = resourcesResult.resources ?? [];
                resources = await this.paginate(() => client.listResources(), resources);
            } catch (exc: unknown) {
                console.warn(
                    "[MCP Client][%s] warmCache listResources failed: %o",
                    this.serverName,
                    exc,
                );
            }

            this.capabilities = {
                tools,
                prompts,
                resources,
                fetchedAt: Date.now(),
            };

            console.log(
                "[MCP Client][%s] Cache warmed: %d tools, %d prompts, %d resources",
                this.serverName,
                tools.length,
                prompts.length,
                resources.length,
            );
        } catch (exc: unknown) {
            console.warn("[MCP Client][%s] warmCache failed: %o", this.serverName, exc);
            throw exc;
        }
    }

    invalidateCache(): void {
        this.capabilities = null;
        this.disconnect();
    }

    // ── Connection management ──────────────────────────────────────

    async close(): Promise<void> {
        this.invalidateCache();
        this.disconnect();
    }

    /**
     * Get a connected MCP Client, resolving auth headers for the given
     * OrchidAuthContext. Reconnects automatically if transport is stale.
     */
    private async getConnectedClient(auth: OrchidAuthContext, timeoutMs?: number): Promise<Client> {
        const authSig = this.computeAuthSig(auth);

        if (this.client && this.connected && authSig === this.lastAuthSig) {
            return this.client;
        }

        await this.reconnect(auth, timeoutMs);
        return this.client!;
    }

    private async reconnect(auth: OrchidAuthContext, timeoutMs?: number): Promise<void> {
        this.disconnect();

        const timeout = timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const headers = await this.resolveAuthHeaders(auth);

            const reqInit: RequestInit = {
                headers: { ...headers },
                signal: controller.signal,
            };

            this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
                requestInit: reqInit,
            });

            this.client = new Client(CLIENT_INFO);

            await Promise.race([
                this.client.connect(this.transport),
                new Promise<never>((_, reject) => {
                    controller.signal.addEventListener("abort", () => {
                        reject(new Error(`Connection timed out after ${timeout}ms`));
                    });
                }),
            ]);

            this.connected = true;
            this.lastAuthSig = this.computeAuthSig(auth);

            console.debug(
                "[MCP Client][%s] Connected (auth_mode=%s)",
                this.serverName,
                this.authMode,
            );
        } catch (exc: unknown) {
            this.connected = false;
            this.client = null;
            this.transport = null;
            throw exc;
        } finally {
            clearTimeout(timer);
        }
    }

    private disconnect(): void {
        if (this.transport) {
            try {
                void this.transport.close().catch(() => {});
            } catch {
                // ignore
            }
            this.transport = null;
        }
        this.client = null;
        this.connected = false;
        this.lastAuthSig = "";
    }

    // ── Auth header resolution ─────────────────────────────────────

    private computeAuthSig(auth: OrchidAuthContext): string {
        if (this.authMode === "none") return "none";
        if (this.authMode === "passthrough") {
            return `passthrough:${auth.tenantKey}:${auth.userId}:${auth.accessToken.substring(0, 8)}`;
        }
        // oauth mode — sig changes per-user, refreshed token changes sig
        return `oauth:${auth.tenantKey}:${auth.userId}`;
    }

    private async resolveAuthHeaders(auth: OrchidAuthContext): Promise<Record<string, string>> {
        switch (this.authMode) {
            case "none":
                return {};

            case "passthrough": {
                if (this.allowedPassthroughHosts.length > 0) {
                    const urlHost = new URL(this.url).host;
                    const allowed = this.allowedPassthroughHosts.some((h) => {
                        if (h === "*") return true;
                        return h === urlHost || urlHost.endsWith(`.${h}`);
                    });
                    if (!allowed) {
                        console.warn(
                            "[MCP Client][%s] Passthrough not allowed for host %s (allowed: %s)",
                            this.serverName,
                            urlHost,
                            this.allowedPassthroughHosts.join(", "),
                        );
                        return {};
                    }
                }
                return auth.bearerHeader;
            }

            case "oauth": {
                return await this.resolveOAuthHeaders(auth);
            }

            default:
                return {};
        }
    }

    private async resolveOAuthHeaders(auth: OrchidAuthContext): Promise<Record<string, string>> {
        if (!this.tokenStore) {
            throw new OrchidMCPAuthRequiredError(this.serverName);
        }

        const tenantId = auth.tenantKey;
        const userId = auth.userId || "anonymous";

        let token = await this.tokenStore.getToken(tenantId, userId, this.serverName);

        if (!token) {
            throw new OrchidMCPAuthRequiredError(this.serverName);
        }

        // Check expiry with buffer
        const now = Date.now() / 1000;
        if (token.expiresAt > 0 && now + TOKEN_EXPIRY_BUFFER_SEC >= token.expiresAt) {
            if (token.isRefreshAvailable) {
                try {
                    token = await this.refreshOAuthToken(token);
                    await this.tokenStore.saveToken(token);
                } catch (exc: unknown) {
                    const msg = exc instanceof Error ? exc.message : String(exc);
                    console.warn(
                        "[MCP Client][%s] Token refresh failed for user %s/%s: %s",
                        this.serverName,
                        tenantId,
                        userId,
                        msg,
                    );
                    // If refresh fails, try using the expired token anyway (server may still accept it)
                }
            }
        }

        return token.bearerHeader;
    }

    // ── Pagination helper ──────────────────────────────────────────

    private async refreshOAuthToken(record: OrchidMCPTokenRecord): Promise<OrchidMCPTokenRecord> {
        if (!record.refreshToken) {
            throw new Error("No refresh token available");
        }

        if (!this.registrationStore) {
            throw new Error("No registration store configured for OAuth refresh");
        }

        const reg = await this.registrationStore.get(record.serverName);
        if (!reg) {
            throw new Error(`No client registration found for server '${record.serverName}'`);
        }

        let headers: Record<string, string> | undefined;
        if (reg.usesBasicAuth && reg.clientId && reg.clientSecret) {
            headers = {
                Authorization: buildBasicAuth(reg.clientId, reg.clientSecret),
            };
        }

        const body: Record<string, string> = {
            grant_type: "refresh_token",
            refresh_token: record.refreshToken,
        };

        // Always include client_id for public clients (no client_secret)
        if (!reg.usesBasicAuth || reg.isPublicClient) {
            body["client_id"] = reg.clientId;
        }

        const data = await httpPost(reg.tokenEndpoint, body, headers);

        const now = Date.now() / 1000;
        const expiresIn = (data["expires_in"] as number) ?? 3600;

        const updated = new OrchidMCPTokenRecord({
            serverName: record.serverName,
            tenantId: record.tenantId,
            userId: record.userId,
            accessToken: data["access_token"] as string,
            refreshToken: (data["refresh_token"] as string | undefined) ?? record.refreshToken,
            expiresAt: now + expiresIn,
            scopes: (data["scope"] as string | undefined) ?? record.scopes,
        });

        return updated;
    }

    // ── Teardown ───────────────────────────────────────────────────

    private async paginate<T extends Record<string, unknown>>(
        fetchMore: () => Promise<{
            nextCursor?: string;
            tools?: T[];
            prompts?: T[];
            resources?: T[];
        }>,
        initial: T[],
    ): Promise<T[]> {
        const all: T[] = [...initial];
        let cursor: string | undefined;
        const maxPages = 20; // safety limit

        try {
            let result = await fetchMore();
            cursor = result.nextCursor;
            for (let page = 0; page < maxPages && cursor; page++) {
                result = await fetchMore();
                const items = (result.tools ?? result.prompts ?? result.resources ?? []) as T[];
                all.push(...items);
                cursor = result.nextCursor;
            }
        } catch (exc: unknown) {
            console.debug("[MCP Client][%s] Pagination fetch failed: %o", this.serverName, exc);
        }

        return all;
    }
}
