/**
 * Shared tool utilities used by both ``GenericAgent`` and ``mini_agent_node``.
 *
 * Extracted from duplicated implementations to honour DIP — high-level code
 * depends on shared abstractions, not copied low-level logic.
 */
import { getTool } from "../config/toolRegistry.js";
import type { MCPCapabilities } from "./mcpDispatcher.js";
import { MCPToolAnnotations } from "./mcpDispatcher.js";

// ── toolsToLiteLLMFormat ────────────────────────────────────────

export interface LiteLLMToolResult {
    names: Set<string>;
    defs: Array<Record<string, unknown>>;
}

export function toolsToLiteLLMFormat(
    toolNames: string[],
    opts?: { skipTools?: Set<string> },
): LiteLLMToolResult {
    const skipTools = opts?.skipTools;
    const names = new Set<string>();
    const defs: Array<Record<string, unknown>> = [];

    for (const toolName of toolNames) {
        if (skipTools && (skipTools.has(toolName) || skipTools.has(`builtin_${toolName}`))) {
            continue;
        }
        let tool;
        try {
            tool = getTool(toolName);
        } catch {
            continue;
        }

        names.add(toolName);
        defs.push(tool.getLLMFunctionSchema());
    }

    return { names, defs };
}

// ── resolveParallelSafety ───────────────────────────────────────

export interface ResolveParallelSafetyOptions {
    toolMap: Record<string, unknown> | Map<string, unknown>;
    builtinToolNames: Set<string>;
    caps: MCPCapabilities | null;
    parallelToolsEnabled: boolean;
    approvalTools?: Set<string>;
    parallelSafeBuiltinTools?: Set<string>;
    mcpParallelOverrides?: Record<string, boolean>;
}

export function resolveParallelSafety(
    opts: ResolveParallelSafetyOptions,
): Record<string, boolean> | null {
    const {
        toolMap,
        builtinToolNames,
        caps,
        parallelToolsEnabled,
        approvalTools,
        parallelSafeBuiltinTools,
        mcpParallelOverrides,
    } = opts;

    if (!parallelToolsEnabled) {
        return null;
    }

    const approvalSet = approvalTools ?? new Set();
    const builtinSafe = parallelSafeBuiltinTools ?? new Set();
    const overrides = mcpParallelOverrides ?? {};

    const safety: Record<string, boolean> = {};
    const toolNames = toolMap instanceof Map ? Array.from(toolMap.keys()) : Object.keys(toolMap);

    for (const toolName of toolNames) {
        if (approvalSet.has(toolName)) {
            safety[toolName] = false;
            continue;
        }
        if (builtinToolNames.has(toolName)) {
            safety[toolName] = builtinSafe.has(toolName);
            continue;
        }

        const override = overrides[toolName];
        if (override !== undefined) {
            safety[toolName] = override;
            continue;
        }

        // MCP tool: check readOnlyHint annotation
        const annotations = getToolAnnotation(caps, toolName);
        safety[toolName] = annotations?.readOnlyHint === true;
    }

    return safety;
}

function getToolAnnotation(
    caps: MCPCapabilities | null,
    toolName: string,
): MCPToolAnnotations | null {
    if (!caps?.toolAnnotations) return null;
    const annotations = caps.toolAnnotations;
    if (annotations instanceof Map) {
        return annotations.get(toolName) ?? null;
    }
    return null;
}
