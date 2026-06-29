/**
 * Tool wrappers for MCP and built-in tool dispatch.
 *
 * Simple wrappers that present a uniform ``ToolWrapper`` interface so the
 * agentic loop can dispatch tools without depending on LangChain ``BaseTool``.
 *
 * Auth is baked into each wrapper at construction time (per-request creation).
 * This avoids threading auth through the Runnable config.
 */
import type { OrchidAuthContext } from "../core/state.js";
import { OrchidMCPToolCaller } from "../core/mcpInterfaces.js";
import { OrchidTool, OrchidToolInput, OrchidToolOutput } from "../core/tool.js";
import { getTool, buildToolInput } from "../config/toolRegistry.js";

// ── ToolWrapper Interface ───────────────────────────────────────

export interface ToolWrapper {
    name: string;
    description: string;
    requiresApproval: boolean;
    invoke(args: Record<string, unknown>): Promise<string>;
}

// ── MCPToolWrapper ──────────────────────────────────────────────

export class MCPToolWrapper implements ToolWrapper {
    name: string;
    description: string;
    requiresApproval: boolean;

    private mcpClient: OrchidMCPToolCaller;
    private auth: OrchidAuthContext;
    private agentName: string;

    constructor(opts: {
        name: string;
        description: string;
        mcpClient: OrchidMCPToolCaller;
        auth: OrchidAuthContext;
        agentName?: string;
        requiresApproval?: boolean;
    }) {
        this.name = opts.name;
        this.description = opts.description;
        this.mcpClient = opts.mcpClient;
        this.auth = opts.auth;
        this.agentName = opts.agentName ?? "";
        this.requiresApproval = opts.requiresApproval ?? false;
    }

    async invoke(args: Record<string, unknown>): Promise<string> {
        const callStart = performance.now();
        try {
            const result = await this.mcpClient.callTool(this.name, args, this.auth);
            const elapsed = (performance.now() - callStart).toFixed(1);
            let text = result.text;
            if (result.isError) {
                text = `[Tool error] ${text}`;
                console.warn(
                    `[PERF][agent=${this.agentName}][mcp.call] tool=${this.name} took ${elapsed}ms ` +
                        `(out_chars=${text.length}, error=true)`,
                );
            } else {
                console.info(
                    `[PERF][agent=${this.agentName}][mcp.call] tool=${this.name} took ${elapsed}ms ` +
                        `(out_chars=${text.length}, error=false)`,
                );
            }
            return text;
        } catch (exc: unknown) {
            const elapsed = (performance.now() - callStart).toFixed(1);
            console.warn(
                `[PERF][agent=${this.agentName}][mcp.call] tool=${this.name} FAILED after ${elapsed}ms: ` +
                    `${exc instanceof Error ? exc.constructor.name : typeof exc}`,
            );
            console.error(`[${this.agentName}] MCP tool '${this.name}' exception:`, exc);
            return `[Tool error] ${exc}`;
        }
    }
}

// ── BuiltinToolWrapper ──────────────────────────────────────────

export class BuiltinToolWrapper implements ToolWrapper {
    name: string;
    description: string;
    requiresApproval: boolean;

    private auth: OrchidAuthContext;
    private agentName: string;
    private contentSources: unknown;

    constructor(opts: {
        name: string;
        description: string;
        auth: OrchidAuthContext;
        agentName?: string;
        requiresApproval?: boolean;
        contentSources?: unknown;
    }) {
        this.name = opts.name;
        this.description = opts.description;
        this.auth = opts.auth;
        this.agentName = opts.agentName ?? "";
        this.requiresApproval = opts.requiresApproval ?? false;
        this.contentSources = opts.contentSources ?? null;
    }

    async invoke(args: Record<string, unknown>): Promise<string> {
        const callStart = performance.now();
        try {
            const tool: OrchidTool = getTool(this.name);
            const toolInput: OrchidToolInput = buildToolInput(tool, {
                ...args,
                authContext: this.auth,
                contentSources: this.contentSources,
            });
            const output: OrchidToolOutput = await tool.invoke(toolInput);
            const elapsed = (performance.now() - callStart).toFixed(1);
            const result = output.result;
            const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
            console.info(
                `[PERF][agent=${this.agentName}][builtin.call] tool=${this.name} took ${elapsed}ms ` +
                    `(out_chars=${text.length})`,
            );
            return text;
        } catch (exc: unknown) {
            const elapsed = (performance.now() - callStart).toFixed(1);
            console.warn(
                `[PERF][agent=${this.agentName}][builtin.call] tool=${this.name} FAILED after ${elapsed}ms: ` +
                    `${exc instanceof Error ? exc.constructor.name : typeof exc}`,
            );
            console.warn(
                `[${this.agentName}] Built-in tool '${this.name}' raised ` +
                    `${exc instanceof Error ? exc.constructor.name : typeof exc}: ${exc}`,
            );
            return `[Tool error] ${exc}`;
        }
    }
}

// ── Builder ─────────────────────────────────────────────────────

export interface BuildToolsOptions {
    builtinNames: Set<string>;
    builtinToolDefs: Array<Record<string, unknown>>;
    mcpToolDefs: Array<Record<string, unknown>>;
    mcpToolClientMap: Map<string, { client: OrchidMCPToolCaller; serverConfig: unknown }>;
    auth: OrchidAuthContext;
    agentName?: string;
    approvalTools?: Set<string>;
    contentSources?: unknown;
}

export function buildLangChainTools(opts: BuildToolsOptions): ToolWrapper[] {
    const {
        builtinToolDefs,
        mcpToolDefs,
        mcpToolClientMap,
        auth,
        agentName = "",
        approvalTools,
        contentSources,
    } = opts;

    const approvalSet: Set<string> = approvalTools instanceof Set
        ? approvalTools
        : Array.isArray(approvalTools)
            ? new Set(approvalTools)
            : new Set();
    const tools: ToolWrapper[] = [];

    // Built-in tools
    for (const toolDef of builtinToolDefs) {
        const fn = (toolDef["function"] as Record<string, unknown>) ?? {};
        const name = String(fn["name"] ?? "");
        const desc = String(fn["description"] ?? name);
        if (!name) continue;

        tools.push(
            new BuiltinToolWrapper({
                name,
                description: desc,
                auth,
                agentName,
                requiresApproval: approvalSet.has(name),
                contentSources,
            }),
        );
    }

    // MCP tools
    for (const toolDef of mcpToolDefs) {
        const fn = (toolDef["function"] as Record<string, unknown>) ?? {};
        const name = String(fn["name"] ?? "");
        const desc = String(fn["description"] ?? name);
        if (!name) continue;

        const entry = mcpToolClientMap.get(name);
        if (!entry) continue;

        tools.push(
            new MCPToolWrapper({
                name,
                description: desc,
                mcpClient: entry.client,
                auth,
                agentName,
                requiresApproval: approvalSet.has(name),
            }),
        );
    }

    return tools;
}
