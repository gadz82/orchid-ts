import type { OrchidTool, OrchidToolInput } from "../core/tool.js";

const FRAMEWORK_PARAMS = new Set([
    "kwargs",
    "self",
    "cls",
    "query",
    "context",
    "authContext",
    "auth_context",
    "_kwargs",
    "contentSources",
    "content_sources",
]);

export interface ToolParameterMetadata {
    name: string;
    type: string;
    description: string;
    required: boolean;
    default: unknown;
}

class ToolRegistry {
    private tools: Map<string, OrchidTool> = new Map();

    register(tool: OrchidTool): void {
        this.tools.set(tool.name, tool);
    }

    get(name: string): OrchidTool {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Built-in tool '${name}' not found in registry`);
        }
        return tool;
    }

    getAll(): Map<string, OrchidTool> {
        return new Map(this.tools);
    }

    clear(): void {
        this.tools.clear();
    }

    unregister(name: string): void {
        this.tools.delete(name);
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }
}

const TOOL_REGISTRY = new ToolRegistry();

export { TOOL_REGISTRY, ToolRegistry };

export function registerTool(_name: string, tool: OrchidTool): void {
    if (!tool.name) {
        tool.name = _name;
    }
    TOOL_REGISTRY.register(tool);
}

export function getTool(name: string): OrchidTool {
    return TOOL_REGISTRY.get(name);
}

export function listTools(): OrchidTool[] {
    return [...TOOL_REGISTRY.getAll().values()];
}

export function clearTools(): void {
    TOOL_REGISTRY.clear();
}

export function unregisterTool(name: string): void {
    TOOL_REGISTRY.unregister(name);
}

export function buildToolInput(tool: OrchidTool, kwargs: Record<string, unknown>): OrchidToolInput {
    const schemaProps = Object.keys(
        (tool.getParametersSchema() as Record<string, unknown>)?.properties ?? {},
    );
    const framework: Record<string, unknown> = {};
    const parameters: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(kwargs)) {
        if (FRAMEWORK_PARAMS.has(key)) {
            framework[key] = value;
            if (schemaProps.includes(key)) {
                parameters[key] = value;
            }
        } else {
            parameters[key] = value;
        }
    }

    return {
        parameters,
        query: framework.query as string | null | undefined,
        context: framework.context as Record<string, unknown> | null | undefined,
        authContext: framework.authContext ?? framework.auth_context,
        contentSources: framework.contentSources ?? framework.content_sources,
    };
}

export async function callTool(
    _name: string,
    kwargs: Record<string, unknown> = {},
): Promise<unknown> {
    const tool = getTool(_name);
    const input = buildToolInput(tool, kwargs);
    const output = await tool.invoke(input);
    return output.result;
}

export async function loadToolsFromConfig(
    toolsConfig: Record<string, unknown>,
    configDir?: string,
): Promise<void> {
    for (const [toolName, _] of Object.entries(toolsConfig)) {
        if (TOOL_REGISTRY.has(toolName)) {
            TOOL_REGISTRY.unregister(toolName);
        }
    }

    await _loadAndRegisterTools(toolsConfig, configDir ?? process.cwd());
}

async function _loadAndRegisterTools(
    toolsConfig: Record<string, unknown>,
    configDir: string,
): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [toolName, rawCfg] of Object.entries(toolsConfig)) {
        const cfg = rawCfg as Record<string, unknown>;
        const handler = (cfg["handler"] as string) ?? null;
        if (!handler) continue;

        promises.push(
            _registerHandlerTool(toolName, handler, cfg, configDir).catch((err) => {
                console.error("[toolRegistry] tool '%s' failed to load: %s", toolName, String(err));
            }),
        );
    }

    try {
        const results = await Promise.allSettled(promises);
        const loaded = results.filter((r) => r.status === "fulfilled").length;
        if (loaded > 0) {
            console.info("[toolRegistry] loaded %d/%d built-in tools", loaded, promises.length);
        }
    } catch {
        // allSettled never throws; safety
    }
}

async function _registerHandlerTool(
    toolName: string,
    handler: string,
    cfg: Record<string, unknown>,
    configDir: string,
): Promise<void> {
    const parts = handler.split("#");
    const modulePath = parts[0];
    const exportName = parts[1] ?? "default";

    const { resolve } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { existsSync } = await import("node:fs");

    let resolvedPath: string;
    if (modulePath.startsWith(".")) {
        resolvedPath = resolve(configDir, modulePath);
    } else {
        resolvedPath = modulePath;
    }

    // tsx resolves .js → .ts for top-level imports, but dynamic
    // import() from compiled dist files may not get the same
    // treatment. Try .ts if the .js file is missing.
    let mod: unknown;
    const candidates = [resolvedPath];
    if (resolvedPath.endsWith(".js")) {
        candidates.push(resolvedPath.replace(/\.js$/, ".ts"));
    } else if (resolvedPath.endsWith(".ts")) {
        candidates.push(resolvedPath.replace(/\.ts$/, ".js"));
    }

    let lastErr: unknown;
    for (const candidate of candidates) {
        try {
            if (!existsSync(candidate)) continue;
            mod = await import(pathToFileURL(candidate).href);
            break;
        } catch (err) {
            lastErr = err;
        }
    }

    if (!mod) {
        throw new Error(
            `Could not import handler '${handler}'. Tried: ${candidates.join(", ")}. Last error: ${String(lastErr)}`,
        );
    }

    const fn = (mod as Record<string, unknown>)[exportName] ?? mod;
    if (typeof fn !== "function") {
        throw new Error(
            `Handler '${handler}' resolved to non-function (got ${typeof fn}). Expected an export named '${exportName}'.`,
        );
    }

    const params = cfg["parameters"] as Record<string, Record<string, unknown>> | undefined;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    if (params) {
        for (const [pName, pCfg] of Object.entries(params)) {
            properties[pName] = {
                type: (pCfg["type"] as string) || "string",
                description: (pCfg["description"] as string) || "",
            };
            if (pCfg["required"] !== false) {
                required.push(pName);
            }
        }
    }

    // Create a lightweight OrchidTool wrapper around the handler function
    const { HandlerTool } = await import("../core/tool.js");
    const wrapper = new HandlerTool({
        name: toolName,
        fn: fn as (args: Record<string, unknown>) => string | Promise<string>,
        description: (cfg["description"] as string) || "",
        properties,
        required,
        requiresApproval: (cfg["requiresApproval"] as boolean) ?? false,
        parallelSafe: (cfg["parallelSafe"] as boolean) ?? false,
        injectToRag: (cfg["injectToRag"] as boolean) ?? false,
        ragTtl: (cfg["ragTtl"] as number) ?? null,
    });

    TOOL_REGISTRY.register(wrapper);
    // Also register under the snake_case alias so skill step `tool:`
    // values (which are not run through snakeToCamel by the loader)
    // still find the right entry.
    const snakeAlias = toolName.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (snakeAlias !== toolName && !TOOL_REGISTRY.has(snakeAlias)) {
        // Create a shallow copy that answers to the snake_case name
        const aliased = new HandlerTool({
            name: snakeAlias,
            fn: fn as (args: Record<string, unknown>) => string | Promise<string>,
            description: (cfg["description"] as string) || "",
            properties,
            required,
            requiresApproval: (cfg["requiresApproval"] as boolean) ?? false,
            parallelSafe: (cfg["parallelSafe"] as boolean) ?? false,
            injectToRag: (cfg["injectToRag"] as boolean) ?? false,
            ragTtl: (cfg["ragTtl"] as number) ?? null,
        });
        TOOL_REGISTRY.register(aliased);
    }
    console.info("[toolRegistry] registered tool '%s'", toolName);
}
