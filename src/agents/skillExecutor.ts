/**
 * Skill execution — runs multi-step agent-level skills.
 *
 * Port of orchid/orchid_ai/agents/skill_executor.py
 */

import type { OrchidAuthContext } from "../core/index.js";
import { extractTextContent } from "../core/helpers.js";
import type { OrchidToolInput } from "../core/index.js";
import type { OrchidAgentSkillStepConfig } from "../config/schema/index.js";
import type { MCPDispatcher } from "./mcpDispatcher.js";

const DEFAULT_MAX_SKILL_DEPTH = 3;

// ── Inline schema filtering (same as Python filter_to_schema) ────

function filterToSchema(
    parameters: Record<string, unknown>,
    schema: Record<string, unknown> | null,
): Record<string, unknown> {
    if (!schema) return { ...parameters };
    const properties = (schema.properties as Record<string, unknown>) ?? {};
    if (!properties || Object.keys(properties).length === 0) {
        return { ...parameters };
    }
    const allowed = new Set(Object.keys(properties));
    const filtered: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(parameters)) {
        if (allowed.has(name)) {
            filtered[name] = value;
        }
    }
    return filtered;
}

// ── SkillExecutor ─────────────────────────────────────────────────

export class SkillExecutor {
    private agentName: string;
    private mcpDispatcher: MCPDispatcher;
    private agentPeers: Record<string, any>;
    private contentSources: any;
    private maxSkillDepth: number;

    constructor(opts: {
        agentName: string;
        mcpDispatcher: MCPDispatcher;
        builtinToolCaller: (
            name: string,
            args: Record<string, unknown>,
            auth: OrchidAuthContext,
        ) => Promise<string>;
        agentPeers?: Record<string, any> | null;
        contentSources?: any;
        maxSkillDepth?: number;
    }) {
        this.agentName = opts.agentName;
        this.mcpDispatcher = opts.mcpDispatcher;
        this.agentPeers = opts.agentPeers ?? {};
        this.contentSources = opts.contentSources;
        this.maxSkillDepth = opts.maxSkillDepth ?? DEFAULT_MAX_SKILL_DEPTH;

        // _builtinToolCaller is stored for external readers (e.g. debug/logging)
        // but not called internally — the registry getTool() path supersedes it.
        void opts.builtinToolCaller;
    }

    async runSkill(
        _skillName: string,
        steps: OrchidAgentSkillStepConfig[],
        query: string,
        auth: OrchidAuthContext,
    ): Promise<Record<string, unknown>> {
        const results: Record<string, unknown> = {};
        const previousResults: Record<string, unknown> = {};
        for (const step of steps) {
            const key = this.stepKey(step);
            const stepResult = await this.runStep(step, query, auth, previousResults);
            results[key] = stepResult;
            previousResults[key] = stepResult;
        }
        return results;
    }

    private async runStep(
        step: OrchidAgentSkillStepConfig,
        query: string,
        auth: OrchidAuthContext,
        previousResults: Record<string, unknown>,
    ): Promise<unknown> {
        const stepName = this.stepKey(step);
        try {
            if (step.agent) {
                return await this.runAgentStep(
                    step.agent,
                    step.instruction,
                    query,
                    auth,
                    previousResults,
                );
            }
            if (step.source && step.source !== "builtin") {
                return await this.mcpDispatcher.callToolBySource(
                    step.source,
                    step.tool ?? stepName,
                    query,
                    auth,
                    (step.arguments as Record<string, unknown>) ?? {},
                    previousResults,
                );
            }
            return await this.runBuiltinStep(
                step.tool ?? stepName,
                query,
                auth,
                (step.arguments as Record<string, unknown>) ?? {},
                previousResults,
                this.contentSources,
            );
        } catch (exc: unknown) {
            const msg = exc instanceof Error ? exc.message : String(exc);
            console.error(`[${this.agentName}] Skill step '${stepName}' failed:`, exc);
            return `error: ${msg}`;
        }
    }

    private async runBuiltinStep(
        toolName: string,
        query: string,
        auth: OrchidAuthContext,
        stepArguments: Record<string, unknown>,
        previousResults: Record<string, unknown>,
        contentSources?: any,
    ): Promise<unknown> {
        // Lazy import to avoid circular deps at module level
        const { getTool } = await import("../config/toolRegistry.js");

        const tool = getTool(toolName);
        const params = filterToSchema(stepArguments, tool.getParametersSchema());

        console.info(
            `[${this.agentName}] Builtin step '${toolName}': params=%o`,
            params,
        );

        const toolInput: OrchidToolInput = {
            parameters: params,
            query,
            context: Object.keys(previousResults).length > 0 ? previousResults : null,
            authContext: auth,
            contentSources,
        };

        const output = await tool.invoke(toolInput);
        return output.result;
    }

    private async runAgentStep(
        agentName: string,
        instruction: string,
        query: string,
        auth: OrchidAuthContext,
        previousResults: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        // Lazy imports to avoid circular deps
        const { runWithContext } = await import("../core/agent.js");

        if (!(agentName in this.agentPeers)) {
            const available = Object.keys(this.agentPeers);
            throw new Error(
                `Agent '${agentName}' not available. Available peers: ${available.join(", ")}`,
            );
        }

        // Depth check — prevent infinite recursion across skill chains.
        // Uses a private instance counter; in Python this is a ContextVar
        // per-asyncio-task.  In TS, mini-agents don't use skill_executor
        // for cross-agent calls, so an instance variable is sufficient.
        const currentDepth = (this as any)._skillDepth ?? 0;
        if (currentDepth >= this.maxSkillDepth) {
            throw new Error(
                `Agent skill depth exceeded (${currentDepth}). ` +
                    `'${this.agentName}' tried to invoke '${agentName}' but max depth of ` +
                    `${this.maxSkillDepth} reached.`,
            );
        }

        const peer = this.agentPeers[agentName];
        let effectiveQuery = instruction || query;
        if (Object.keys(previousResults).length > 0) {
            const contextStr = JSON.stringify(previousResults, null, 2);
            effectiveQuery += `\n\nContext from previous steps:\n\`\`\`json\n${contextStr}\n\`\`\``;
        }

        const miniState: Record<string, unknown> = {
            messages: [{ type: "human", content: effectiveQuery }],
            chatId: "",
            mcpContext: {},
            activeAgents: [],
            ragContext: {},
            finalResponse: null,
            skillInstructions: {},
            _hasOutputGuardrails: false,
        };

        // Bind auth on the peer for this direct run() call via runWithContext.
        const depthToken = ((this as any)._skillDepth = currentDepth + 1);
        try {
            console.info(
                `[${this.agentName}] Invoking peer '${agentName}' (depth=${currentDepth + 1}): %s`,
                effectiveQuery.slice(0, 120),
            );

            const resultState = (await runWithContext(
                {
                    auth,
                    correlationId: null,
                    chatId: null,
                    messageId: null,
                },
                () => peer.run(miniState),
            )) as Record<string, unknown>;
            (this as any)._skillDepth = depthToken - 1;

            const mcpData = (resultState.mcpContext as Record<string, unknown>) ?? {};
            const messages = (resultState.messages as Array<Record<string, unknown>>) ?? [];
            const responseText = messages.length > 0 ? extractTextContent(messages[0].content) : "";

            return {
                agent: agentName,
                data: mcpData[agentName] ?? mcpData,
                response: responseText,
            };
        } finally {
            (this as any)._skillDepth = currentDepth;
        }
    }

    /** Derive the canonical key for a skill step (tool name or agent name). */
    private stepKey(step: OrchidAgentSkillStepConfig): string {
        return step.tool || step.agent || "unknown";
    }
}
