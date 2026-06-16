/** MCP tool dispatch — orchestrates tool calls across MCP servers. */

import type { OrchidAuthContext } from "../core/state.js";
import type { OrchidMCPToolCaller } from "../core/mcpInterfaces.js";
import { OrchidMCPAuthRequiredError } from "../core/mcpErrors.js";
import type { ChatModelLike } from "../core/helpers.js";
import type { OrchidMCPServerConfig, OrchidToolConfig } from "../config/schema/mcp.js";
import { OrchidToolConfigSchema } from "../config/schema/mcp.js";
import { getStrategy } from "./strategies.js";

// Re-export OrchidMCPToolCaller so consumers that import from
// agents/ can use the base interface without reaching into core/.
export type { OrchidMCPToolCaller } from "../core/mcpInterfaces.js";

// ── MCPToolAnnotations ──────────────────────────────────────────

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

// ── MCPCapabilities ─────────────────────────────────────────────

export class MCPCapabilities {
    rawTools: Array<Record<string, unknown>> = [];
    toolClientMap: Map<string, [OrchidMCPToolCaller, OrchidMCPServerConfig]> = new Map();
    toolAnnotations: Map<string, MCPToolAnnotations> = new Map();
    renderedPrompts: Array<{ name: string; text: string }> = [];
    resourceContents: Map<string, string> = new Map();
    skippedPrompts: Array<{ name: string; description: string; requiredArgs: string[] }> = [];
}

// ── Internal client type for discovery-capable clients ──────────

type DiscoverableClient = OrchidMCPToolCaller & {
    listTools(auth: OrchidAuthContext): Promise<Record<string, unknown>[]>;
    listPrompts(auth: OrchidAuthContext): Promise<Record<string, unknown>[]>;
    listResources(auth: OrchidAuthContext): Promise<Record<string, unknown>[]>;
    getPrompt(
        name: string,
        args: Record<string, string>,
        auth: OrchidAuthContext,
    ): Promise<Record<string, unknown>[]>;
    readResource(uri: string, auth: OrchidAuthContext): Promise<string>;
};

function asDiscoverable(client: OrchidMCPToolCaller): DiscoverableClient {
    return client as unknown as DiscoverableClient;
}

// ── Shared capability discovery helpers ─────────────────────────

export async function _discoverServerTools(
    client: OrchidMCPToolCaller,
    serverConfig: OrchidMCPServerConfig,
    auth: OrchidAuthContext,
    agentName: string,
): Promise<Record<string, unknown>[]> {
    if (!(serverConfig.discoverAllTools || serverConfig.tools.length > 0)) {
        return [];
    }
    try {
        const rawTools = await asDiscoverable(client).listTools(auth);
        if (!serverConfig.discoverAllTools && serverConfig.tools.length > 0) {
            const whitelist = new Set(serverConfig.tools.map((t: OrchidToolConfig) => t.name));
            return rawTools.filter((t: Record<string, unknown>) =>
                whitelist.has(t["name"] as string),
            );
        }
        console.log(
            "[%s] Discovered %d tools from '%s': %o",
            agentName,
            rawTools.length,
            serverConfig.name,
            rawTools.map((t: Record<string, unknown>) => t["name"]),
        );
        return rawTools;
    } catch (exc: unknown) {
        console.warn(
            "[%s] Could not discover tools from '%s': %o",
            agentName,
            serverConfig.name,
            exc,
        );
        return [];
    }
}

export async function _discoverServerPrompts(
    client: OrchidMCPToolCaller,
    serverConfig: OrchidMCPServerConfig,
    auth: OrchidAuthContext,
    agentName: string,
): Promise<Record<string, unknown>[] | null> {
    if (!(serverConfig.discoverAllPrompts || serverConfig.prompts.length > 0)) {
        return null;
    }
    try {
        let prompts = await asDiscoverable(client).listPrompts(auth);
        if (!serverConfig.discoverAllPrompts && serverConfig.prompts.length > 0) {
            const allowed = new Set(serverConfig.prompts);
            prompts = prompts.filter((p: Record<string, unknown>) =>
                allowed.has(p["name"] as string),
            );
        }
        if (prompts.length > 0) {
            console.log(
                "[%s] Loaded %d prompts from '%s'",
                agentName,
                prompts.length,
                serverConfig.name,
            );
            return prompts;
        }
    } catch (exc: unknown) {
        console.warn(
            "[%s] Could not load prompts from '%s': %o",
            agentName,
            serverConfig.name,
            exc,
        );
    }
    return null;
}

export async function _discoverServerResources(
    client: OrchidMCPToolCaller,
    serverConfig: OrchidMCPServerConfig,
    auth: OrchidAuthContext,
    agentName: string,
): Promise<Record<string, unknown>[] | null> {
    if (!(serverConfig.discoverAllResources || serverConfig.resources.length > 0)) {
        return null;
    }
    try {
        let resources = await asDiscoverable(client).listResources(auth);
        if (!serverConfig.discoverAllResources && serverConfig.resources.length > 0) {
            const allowed = new Set(serverConfig.resources);
            resources = resources.filter(
                (r: Record<string, unknown>) =>
                    allowed.has(r["name"] as string) || allowed.has(r["uri"] as string),
            );
        }
        if (resources.length > 0) {
            console.log(
                "[%s] Loaded %d resources from '%s'",
                agentName,
                resources.length,
                serverConfig.name,
            );
            return resources;
        }
    } catch (exc: unknown) {
        console.warn(
            "[%s] Could not load resources from '%s': %o",
            agentName,
            serverConfig.name,
            exc,
        );
    }
    return null;
}

// ── MCPDispatcher ───────────────────────────────────────────────

export class MCPDispatcher {
    private clients: OrchidMCPToolCaller[];
    private configs: OrchidMCPServerConfig[];
    private cachedCapabilities: MCPCapabilities | null = null;

    constructor(clients: OrchidMCPToolCaller[], serverConfigs: OrchidMCPServerConfig[]) {
        this.clients = clients;
        this.configs = serverConfigs;
        this.cachedCapabilities = null;
    }

    // ── fetch() ─────────────────────────────────────────────────

    static mcpToolsToLiteLLM(
        mcpTools: Array<Record<string, unknown>>,
    ): Array<Record<string, unknown>> {
        const result: Array<Record<string, unknown>> = [];
        for (const tool of mcpTools) {
            let schema =
                (tool["schema"] as Record<string, unknown>) ??
                (tool["inputSchema"] as Record<string, unknown>) ??
                {};
            if (!("type" in schema)) {
                schema = { type: "object", properties: schema["properties"] ?? {} };
            }
            result.push({
                type: "function",
                function: {
                    name: tool["name"] as string,
                    description: (tool["description"] as string) || (tool["name"] as string),
                    parameters: schema,
                },
            });
        }
        return result;
    }

    // ── callToolBySource() ──────────────────────────────────────

    async fetch(
        query: string,
        auth: OrchidAuthContext,
        opts?: {
            agentName?: string;
            llmModel?: string | null;
            chatModel?: ChatModelLike | null;
            skipTools?: Set<string>;
        },
    ): Promise<Record<string, unknown>> {
        const agentName = opts?.agentName ?? "";
        const skipTools = opts?.skipTools;

        if (this.clients.length === 0 || this.configs.length === 0) {
            return {};
        }

        const fetchServer = async (
            i: number,
            serverConfig: OrchidMCPServerConfig,
        ): Promise<Record<string, unknown>> => {
            if (i >= this.clients.length) {
                console.warn(
                    "[%s] No MCP client for server '%s' (index %d)",
                    agentName,
                    serverConfig.name,
                    i,
                );
                return {};
            }

            const client = this.clients[i];
            const serverResults: Record<string, unknown> = {};

            try {
                let effectiveTools = serverConfig.tools;

                if (
                    serverConfig.discoverAllTools ||
                    serverConfig.prompts.length > 0 ||
                    serverConfig.resources.length > 0 ||
                    serverConfig.discoverAllPrompts ||
                    serverConfig.discoverAllResources
                ) {
                    const { discoveredTools, meta } = await this._discoverCapabilities(
                        client,
                        serverConfig,
                        auth,
                        agentName,
                    );
                    if (serverConfig.discoverAllTools) {
                        effectiveTools = discoveredTools;
                    }
                    Object.assign(serverResults, meta);
                }

                if (skipTools && skipTools.size > 0) {
                    effectiveTools = effectiveTools.filter(
                        (t: OrchidToolConfig) => !skipTools.has(t.name),
                    );
                    if (effectiveTools.length === 0) {
                        console.log(
                            "[%s] All tools for '%s' skipped (cache hits)",
                            agentName,
                            serverConfig.name,
                        );
                        return serverResults;
                    }
                }

                const strategy = getStrategy(serverConfig.toolCallStrategy);
                const toolResults = await strategy.execute(client, effectiveTools, query, auth, {
                    agentName,
                    serverConfig,
                    llmModel: opts?.llmModel ?? undefined,
                    chatModel: opts?.chatModel ?? undefined,
                });
                Object.assign(serverResults, toolResults);
            } catch (exc: unknown) {
                if (exc instanceof OrchidMCPAuthRequiredError) {
                    console.log(
                        "[%s] MCP server '%s' skipped — OAuth authorization required",
                        agentName,
                        serverConfig.name,
                    );
                    serverResults[`${serverConfig.name}_auth_required`] = true;
                } else {
                    console.error(
                        "[%s] MCP server '%s' failed: %o",
                        agentName,
                        serverConfig.name,
                        exc,
                    );
                    serverResults[`${serverConfig.name}_error`] = String(exc);
                }
            }

            return serverResults;
        };

        const perServer = await Promise.all(this.configs.map((cfg, i) => fetchServer(i, cfg)));

        const merged: Record<string, unknown> = {};
        for (const serverResult of perServer) {
            Object.assign(merged, serverResult);
        }
        return merged;
    }

    // ── renderCapabilities() ────────────────────────────────────

    async callToolBySource(
        sourceName: string,
        toolName: string,
        query: string,
        auth: OrchidAuthContext,
        extraArgs: Record<string, unknown>,
        previousResults: Record<string, unknown>,
    ): Promise<string> {
        for (let i = 0; i < this.configs.length; i++) {
            const serverConfig = this.configs[i];
            if (serverConfig.name === sourceName && i < this.clients.length) {
                const client = this.clients[i];
                const args: Record<string, unknown> = { query, ...extraArgs };
                if (Object.keys(previousResults).length > 0) {
                    args["previous_results"] = JSON.stringify(previousResults);
                }
                const result = await client.callTool(toolName, args, auth);
                return result.text;
            }
        }
        throw new Error(`MCP server '${sourceName}' not found`);
    }

    // ── mcpToolsToLiteLLM() ─────────────────────────────────────

    async renderCapabilities(
        auth: OrchidAuthContext,
        opts?: {
            agentName?: string;
        },
    ): Promise<MCPCapabilities> {
        if (this.cachedCapabilities !== null) {
            return this.cachedCapabilities;
        }

        const caps = new MCPCapabilities();
        const agentName = opts?.agentName ?? "";
        const renderStart = performance.now();
        const resourceEntries: Array<{ name: string; uri: string; content: string }> = [];

        if (this.clients.length === 0 || this.configs.length === 0) {
            return caps;
        }

        const renderServer = async (
            i: number,
            serverConfig: OrchidMCPServerConfig,
        ): Promise<void> => {
            if (i >= this.clients.length) return;

            const client = this.clients[i];
            const serverName = serverConfig.name;
            const srvStart = performance.now();

            // ── Tools ──────────────────────────────────────────
            if (serverConfig.discoverAllTools || serverConfig.tools.length > 0) {
                const listToolsStart = performance.now();
                const rawTools = await _discoverServerTools(client, serverConfig, auth, agentName);
                const listToolsElapsed = performance.now() - listToolsStart;
                console.log(
                    "[PERF][agent=%s][mcp] list_tools server=%s took %.1f ms (raw_count=%d)",
                    agentName,
                    serverName,
                    listToolsElapsed,
                    rawTools.length,
                );
                for (const t of rawTools) {
                    caps.rawTools.push(t);
                    caps.toolClientMap.set(t["name"] as string, [client, serverConfig]);
                    const annotations = MCPToolAnnotations.fromRaw(t["annotations"]);
                    if (annotations !== null) {
                        caps.toolAnnotations.set(t["name"] as string, annotations);
                    }
                }
            }

            // ── Prompts ────────────────────────────────────────
            if (serverConfig.discoverAllPrompts || serverConfig.prompts.length > 0) {
                const listPromptsStart = performance.now();
                const prompts = await _discoverServerPrompts(client, serverConfig, auth, agentName);
                const listPromptsElapsed = performance.now() - listPromptsStart;
                console.log(
                    "[PERF][agent=%s][mcp] list_prompts server=%s took %.1f ms (count=%d)",
                    agentName,
                    serverName,
                    listPromptsElapsed,
                    prompts?.length ?? 0,
                );

                if (prompts) {
                    for (const promptDef of prompts) {
                        const arguments_ = promptDef["arguments"] as
                            | Array<Record<string, unknown>>
                            | undefined;
                        const hasRequired =
                            arguments_?.some(
                                (a: Record<string, unknown>) => a["required"] === true,
                            ) ?? false;

                        if (hasRequired) {
                            caps.skippedPrompts.push({
                                name: promptDef["name"] as string,
                                description: (promptDef["description"] as string) ?? "",
                                requiredArgs: (arguments_ ?? []).map(
                                    (a: Record<string, unknown>) => a["name"] as string,
                                ),
                            });
                            continue;
                        }

                        try {
                            const rendered = await asDiscoverable(client).getPrompt(
                                promptDef["name"] as string,
                                {},
                                auth,
                            );
                            for (const msg of rendered) {
                                if (msg["role"] === "system") {
                                    caps.renderedPrompts.push({
                                        name: promptDef["name"] as string,
                                        text: msg["content"] as string,
                                    });
                                }
                            }
                        } catch (exc: unknown) {
                            console.warn(
                                "[%s] Could not render prompt '%s' from '%s': %o",
                                agentName,
                                promptDef["name"],
                                serverName,
                                exc,
                            );
                        }
                    }
                }
            }

            // ── Resources ──────────────────────────────────────
            if (serverConfig.discoverAllResources || serverConfig.resources.length > 0) {
                const listResourcesStart = performance.now();
                const resources = await _discoverServerResources(
                    client,
                    serverConfig,
                    auth,
                    agentName,
                );
                const listResourcesElapsed = performance.now() - listResourcesStart;
                console.log(
                    "[PERF][agent=%s][mcp] list_resources server=%s took %.1f ms (count=%d)",
                    agentName,
                    serverName,
                    listResourcesElapsed,
                    resources?.length ?? 0,
                );

                if (resources) {
                    for (const res of resources) {
                        try {
                            const content = await asDiscoverable(client).readResource(
                                res["uri"] as string,
                                auth,
                            );
                            if (content) {
                                resourceEntries.push({
                                    name: res["name"] as string,
                                    uri: res["uri"] as string,
                                    content,
                                });
                            }
                        } catch (exc: unknown) {
                            console.warn(
                                "[%s] Could not read resource '%s' from '%s': %o",
                                agentName,
                                res["uri"],
                                serverName,
                                exc,
                            );
                        }
                    }
                }
            }

            const srvElapsed = performance.now() - srvStart;
            console.log(
                "[PERF][agent=%s][mcp] discover server=%s took %.1f ms",
                agentName,
                serverName,
                srvElapsed,
            );
        };

        await Promise.all(this.configs.map((cfg, i) => renderServer(i, cfg)));

        const nameCounts = new Map<string, number>();
        for (const entry of resourceEntries) {
            nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
        }
        for (const entry of resourceEntries) {
            let label = entry.name;
            if ((nameCounts.get(entry.name) ?? 0) > 1) {
                label = `${entry.name} (${entry.uri})`;
            }
            caps.resourceContents.set(label, entry.content);
        }

        const renderElapsed = performance.now() - renderStart;
        console.log(
            "[PERF][agent=%s][mcp] render_capabilities total=%.1f ms (servers=%d, tools_total=%d)",
            agentName,
            renderElapsed,
            this.configs.length,
            caps.rawTools.length,
        );

        this.cachedCapabilities = caps;
        return caps;
    }

    // ── _discoverCapabilities (private) ─────────────────────────

    private async _discoverCapabilities(
        client: OrchidMCPToolCaller,
        serverConfig: OrchidMCPServerConfig,
        auth: OrchidAuthContext,
        agentName: string,
    ): Promise<{ discoveredTools: OrchidToolConfig[]; meta: Record<string, unknown> }> {
        const serverName = serverConfig.name;
        const meta: Record<string, unknown> = {};

        const discoverRawTools = async (): Promise<OrchidToolConfig[]> => {
            if (!serverConfig.discoverAllTools) return [];
            try {
                const rawTools = await asDiscoverable(client).listTools(auth);
                const tools: OrchidToolConfig[] = rawTools.map((t: Record<string, unknown>) =>
                    OrchidToolConfigSchema.parse({ name: t["name"] as string }),
                );
                console.log(
                    "[%s] Discovered %d tools from '%s': %o",
                    agentName,
                    tools.length,
                    serverName,
                    tools.map((t: OrchidToolConfig) => t.name),
                );
                return tools;
            } catch (exc: unknown) {
                console.warn(
                    "[%s] Could not discover tools from '%s': %o",
                    agentName,
                    serverName,
                    exc,
                );
                return [];
            }
        };

        const promptsResult = await _discoverServerPrompts(client, serverConfig, auth, agentName);
        const resourcesResult = await _discoverServerResources(
            client,
            serverConfig,
            auth,
            agentName,
        );
        const toolsResult = await discoverRawTools();

        if (promptsResult) {
            meta[`${serverName}_prompts`] = promptsResult;
        }
        if (resourcesResult) {
            meta[`${serverName}_resources`] = resourcesResult;
        }

        return { discoveredTools: toolsResult, meta };
    }
}
