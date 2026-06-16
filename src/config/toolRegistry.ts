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

export function loadToolsFromConfig(toolsConfig: Record<string, unknown>): void {
    for (const [toolName, __unused] of Object.entries(toolsConfig)) {
        if (TOOL_REGISTRY.has(toolName)) {
            TOOL_REGISTRY.unregister(toolName);
        }
    }
}
