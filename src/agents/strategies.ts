/**
 * Tool call strategies for MCP server interaction — Strategy pattern (OCP).
 *
 * Each strategy defines *how* tools on a single MCP server are invoked:
 *   - ``all``          — call every whitelisted tool, collect all results
 *   - ``sequential``   — call tools in order, chaining context forward
 *   - ``llm_decides``  — ask the LLM which tools to call and with what args
 *
 * Adding a new strategy:
 *   1. Implement ``OrchidToolCallStrategy``
 *   2. Register it in ``STRATEGY_REGISTRY``
 *   3. Reference by name in ``agents.yaml`` → ``tool_call_strategy: my_strategy``
 */
import type { OrchidAuthContext } from "../core/state.js";
import { OrchidMCPToolCaller, OrchidMCPDiscoverable } from "../core/mcpInterfaces.js";
import type { ChatModelLike } from "../core/helpers.js";
import { extractTextContent } from "../core/helpers.js";
import type { OrchidToolConfig, OrchidMCPServerConfig } from "../config/schema/mcp.js";

// ── Strategy Interface ──────────────────────────────────────────

export interface OrchidToolCallStrategy {
    execute(
        client: OrchidMCPToolCaller,
        tools: OrchidToolConfig[],
        query: string,
        auth: OrchidAuthContext,
        opts?: {
            agentName?: string;
            serverConfig?: OrchidMCPServerConfig;
            llmModel?: string;
            chatModel?: ChatModelLike;
        },
    ): Promise<Record<string, unknown>>;
}

// ── CallAllStrategy ─────────────────────────────────────────────

export class CallAllStrategy implements OrchidToolCallStrategy {
    async execute(
        client: OrchidMCPToolCaller,
        tools: OrchidToolConfig[],
        query: string,
        auth: OrchidAuthContext,
        opts?: { agentName?: string },
    ): Promise<Record<string, unknown>> {
        const agentName = opts?.agentName ?? "";

        const pairs = await Promise.all(
            tools.map(async (tool) => {
                try {
                    const args: Record<string, unknown> = { query, ...tool.arguments };
                    const result = await client.callTool(tool.name, args, auth);
                    return [tool.name, result.text] as const;
                } catch (exc: unknown) {
                    console.error(`[${agentName}] Tool '${tool.name}' failed:`, exc);
                    return [`${tool.name}_error`, String(exc)] as const;
                }
            }),
        );

        return Object.fromEntries(pairs);
    }
}

// ── SequentialStrategy ──────────────────────────────────────────

export class SequentialStrategy implements OrchidToolCallStrategy {
    async execute(
        client: OrchidMCPToolCaller,
        tools: OrchidToolConfig[],
        query: string,
        auth: OrchidAuthContext,
        opts?: { agentName?: string },
    ): Promise<Record<string, unknown>> {
        const agentName = opts?.agentName ?? "";
        const results: Record<string, unknown> = {};
        const previousResults: Record<string, unknown> = {};

        for (const tool of tools) {
            try {
                const args: Record<string, unknown> = { query, ...tool.arguments };
                if (Object.keys(previousResults).length > 0) {
                    args["previous_results"] = JSON.stringify(previousResults);
                }
                const result = await client.callTool(tool.name, args, auth);
                results[tool.name] = result.text;
                previousResults[tool.name] = result.text;
            } catch (exc: unknown) {
                console.error(`[${agentName}] Sequential tool '${tool.name}' failed:`, exc);
                results[`${tool.name}_error`] = String(exc);
            }
        }

        return results;
    }
}

// ── LLMDecidesStrategy ──────────────────────────────────────────

function hasListTools(
    client: OrchidMCPToolCaller,
): client is OrchidMCPToolCaller & Pick<OrchidMCPDiscoverable, "listTools"> {
    return typeof (client as unknown as Record<string, unknown>)["listTools"] === "function";
}

export class LLMDecidesStrategy implements OrchidToolCallStrategy {
    async execute(
        client: OrchidMCPToolCaller,
        tools: OrchidToolConfig[],
        query: string,
        auth: OrchidAuthContext,
        opts?: {
            agentName?: string;
            serverConfig?: OrchidMCPServerConfig;
            llmModel?: string;
            chatModel?: ChatModelLike;
        },
    ): Promise<Record<string, unknown>> {
        const agentName = opts?.agentName ?? "";
        const serverConfig = opts?.serverConfig;
        const results: Record<string, unknown> = {};

        // Discover available tool descriptions from the server
        let availableTools: Record<string, unknown>[] = [];
        if (hasListTools(client)) {
            try {
                availableTools = await client.listTools(auth);
            } catch (exc: unknown) {
                console.warn(`[${agentName}] Could not list tools:`, exc);
            }
        }

        // Filter to whitelisted tools (skip filter when discover_all / wildcard)
        const discoverAll = serverConfig?.discoverAllTools ?? false;
        const relevantTools = discoverAll
            ? availableTools
            : availableTools.filter((t) => tools.some((wt) => wt.name === t["name"]));

        if (relevantTools.length === 0) {
            return results;
        }

        // Ask the LLM which tools to call
        const toolDescriptions = relevantTools
            .map((t) => `- ${t["name"]}: ${t["description"] ?? "No description"}`)
            .join("\n");

        const decisionPrompt = [
            `User query: ${query}`,
            "",
            `Available tools:\n${toolDescriptions}`,
            "",
            "Decide which tools to call and with what arguments. " +
                "Respond with a JSON array of objects: " +
                '[{"tool": "tool_name", "arguments": {...}}, ...]',
            "Only include tools that are relevant to the query. " +
                "Respond ONLY with the JSON array.",
        ].join("\n");

        const chatModel = opts?.chatModel;

        let raw: string;
        try {
            raw = await this.llmComplete(chatModel, [{ role: "user", content: decisionPrompt }], {
                temperature: 0,
                responseFormat: { type: "json_object" },
            });
        } catch (exc: unknown) {
            console.error(`[${agentName}] LLM API error during tool decision:`, exc);
            // Fallback: call all tools
            return getStrategy("all").execute(client, tools, query, auth, { agentName });
        }

        let decisions: unknown[];
        try {
            const parsed = JSON.parse(raw);
            decisions = Array.isArray(parsed) ? parsed : (parsed?.["tools"] ?? []);
        } catch {
            console.warn(
                `[${agentName}] LLM tool decision was not valid JSON: ${raw.slice(0, 200)}`,
            );
            return getStrategy("all").execute(client, tools, query, auth, { agentName });
        }

        // Execute decided tools
        const allowed = new Set(relevantTools.map((t) => String(t["name"])));
        for (const decision of decisions) {
            const d = decision as Record<string, unknown>;
            const toolName = String(d["tool"] ?? "");
            const toolArgs = (d["arguments"] as Record<string, unknown>) ?? {};
            if (!allowed.has(toolName)) continue;
            try {
                const result = await client.callTool(toolName, toolArgs, auth);
                results[toolName] = result.text;
            } catch (exc: unknown) {
                console.error(`[${agentName}] LLM-decided tool '${toolName}' failed:`, exc);
                results[`${toolName}_error`] = String(exc);
            }
        }

        return results;
    }

    private async llmComplete(
        chatModel: ChatModelLike | undefined,
        messages: Record<string, unknown>[],
        opts?: { temperature?: number; responseFormat?: Record<string, string> },
    ): Promise<string> {
        if (!chatModel) {
            throw new Error(
                "LLMDecidesStrategy requires a ChatModelLike. Pass chatModel in opts when building the graph.",
            );
        }
        const options: Record<string, unknown> = { temperature: opts?.temperature ?? 0.0 };
        if (opts?.responseFormat) {
            options["response_format"] = opts.responseFormat;
        }
        const result = await chatModel.invoke(messages, options);
        return extractTextContent(result.content);
    }
}

// ── Strategy Registry ───────────────────────────────────────────

type StrategyConstructor = new () => OrchidToolCallStrategy;

const STRATEGY_REGISTRY: Map<string, StrategyConstructor> = new Map([
    ["all", CallAllStrategy],
    ["sequential", SequentialStrategy],
    ["llm_decides", LLMDecidesStrategy],
]);

export function registerStrategy(name: string, cls: StrategyConstructor): void {
    STRATEGY_REGISTRY.set(name, cls);
    console.log(`[Strategies] Registered '${name}' → ${cls.name}`);
}

export function clearStrategies(): void {
    STRATEGY_REGISTRY.clear();
    STRATEGY_REGISTRY.set("all", CallAllStrategy);
    STRATEGY_REGISTRY.set("sequential", SequentialStrategy);
    STRATEGY_REGISTRY.set("llm_decides", LLMDecidesStrategy);
}

export function getStrategy(name: string): OrchidToolCallStrategy {
    let Ctor = STRATEGY_REGISTRY.get(name);
    if (!Ctor) {
        console.warn(`Unknown tool call strategy '${name}', falling back to 'all'`);
        Ctor = STRATEGY_REGISTRY.get("all") ?? CallAllStrategy;
    }
    return new Ctor();
}
