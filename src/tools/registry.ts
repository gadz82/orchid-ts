/**
 * In-memory tool registry with schema helpers.
 *
 * Provides register / get / unregister operations plus utilities for
 * building a filtered tool-input and extracting JSON Schema from
 * the tool's parametersSchema.
 */

import type { OrchidToolInput } from "../core/tool.js";
import { OrchidTool } from "../core/tool.js";

export class ToolRegistry {
    private tools: Map<string, OrchidTool> = new Map();

    register(tool: OrchidTool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool '${tool.name}' is already registered`);
        }
        this.tools.set(tool.name, tool);
    }

    get(name: string): OrchidTool {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool '${name}' not found in registry`);
        }
        return tool;
    }

    getAll(): ReadonlyMap<string, OrchidTool> {
        return this.tools;
    }

    unregister(name: string): void {
        this.tools.delete(name);
    }

    clear(): void {
        this.tools.clear();
    }
}

/**
 * Build a minimal OrchidToolInput from a flat parameters object.
 * Useful for tests and calling tools programmatically.
 */
export function buildToolInput(opts?: {
    parameters?: Record<string, unknown>;
    query?: string;
    context?: Record<string, unknown>;
    authContext?: unknown;
    contentSources?: unknown;
}): OrchidToolInput {
    return {
        parameters: opts?.parameters ?? {},
        query: opts?.query ?? null,
        context: opts?.context ?? null,
        authContext: opts?.authContext ?? undefined,
        contentSources: opts?.contentSources ?? undefined,
    };
}

/**
 * Produce a JSON Schema object from the tool's parametersSchema,
 * suitable for inclusion in an LLM function-calling definition.
 *
 * Returns `{ type: 'object', properties: {} }` as a safe default
 * when the schema is missing or malformed.
 */
export function filterToSchema(
    parametersSchema: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
    if (!parametersSchema || typeof parametersSchema !== "object") {
        return { type: "object", properties: {} };
    }

    const clone = JSON.parse(JSON.stringify(parametersSchema));
    if (!clone.type) {
        clone.type = "object";
    }
    if (!clone.properties || typeof clone.properties !== "object") {
        clone.properties = {};
    }

    // Strip framework-reserved keys so the LLM is never asked to supply them
    const props = clone.properties as Record<string, unknown>;
    const reserved = new Set(["query", "context", "auth_context", "content_sources"]);
    for (const key of Object.keys(props)) {
        if (reserved.has(key)) {
            delete props[key];
        }
    }

    return clone;
}

/**
 * Look up a tool by name in the registry and return its parameters
 * schema, already filtered for LLM consumption.
 */
export function getToolSchema(registry: ToolRegistry, name: string): Record<string, unknown> {
    const tool = registry.get(name);
    return filterToSchema(tool.parametersSchema);
}
