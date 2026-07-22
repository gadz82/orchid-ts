/**
 * Agentic tool-calling loop — extracted from GenericAgent (SRP).
 *
 * Manages the multi-round LLM -> tool-call -> result cycle with:
 * - Unified MCP + built-in tool dispatch via ToolWrapper
 * - Duplicate call detection and consecutive-dupe stripping
 * - Max-round safety (prevents infinite loops)
 * - HITL interrupt for tools requiring approval
 * - Per-call error handling
 * - Optional parallel dispatch of read-only / idempotent tools within a
 *   single round — opt-in via ``parallelSafety`` map.
 */
import type { ChatModelLike } from "../core/index.js";
import { extractTextContent } from "../core/helpers.js";
import type { ToolWrapper } from "./tools.js";
import { GraphInterrupt } from "../core/graphInterrupt.js";

const DEFAULT_MAX_TOOL_ROUNDS = 15;
const DEFAULT_MAX_CONSECUTIVE_DUPES = 2;

function isParallelSafe(toolName: string, parallelSafety: Record<string, boolean> | null): boolean {
    if (parallelSafety === null) return false;
    return !!parallelSafety[toolName];
}

function makeEvent(eventType: string, eventData: Record<string, unknown>): Record<string, unknown> {
    return { _event: eventType, ...eventData, _timestamp: Date.now() };
}

export interface AgenticLoopOptions {
    agentName: string;
    chatModel: ChatModelLike;
    toolMap: Map<string, ToolWrapper>;
    allToolDefs: Array<Record<string, unknown>>;
    temperature?: number;
    parallelSafety?: Record<string, boolean> | null;
    toolSubset?: string[] | null;
    isMini?: boolean;
    maxToolRounds?: number;
    maxConsecutiveDupes?: number;
}

export class AgenticLoop {
    readonly events: Array<Record<string, unknown>> = [];
    isMini: boolean;
    private agentName: string;
    private chatModel: ChatModelLike;
    private temperature: number;
    private maxToolRounds: number;
    private maxConsecutiveDupes: number;
    private toolMap: Map<string, ToolWrapper>;
    private allToolDefs: Array<Record<string, unknown>>;
    private parallelSafety: Record<string, boolean> | null;
    private seenCalls = new Map<string, string>();
    private consecutiveDupes = 0;
    private toolResults: Record<string, unknown> = {};
    private boundModel: any;

    constructor(opts: AgenticLoopOptions) {
        this.agentName = opts.agentName;
        this.chatModel = opts.chatModel;
        this.temperature = opts.temperature ?? 0.2;
        this.maxToolRounds = opts.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
        this.maxConsecutiveDupes = opts.maxConsecutiveDupes ?? DEFAULT_MAX_CONSECUTIVE_DUPES;
        this.isMini = opts.isMini ?? false;
        this.parallelSafety = opts.parallelSafety ?? null;

        if (opts.toolSubset !== undefined && opts.toolSubset !== null) {
            const allowed = new Set(opts.toolSubset);
            this.toolMap = new Map();
            for (const [name, wrapper] of opts.toolMap) {
                if (allowed.has(name)) this.toolMap.set(name, wrapper);
            }
            this.allToolDefs = opts.allToolDefs.filter((td) =>
                allowed.has(((td as any).function?.name as string) ?? ""),
            );
        } else {
            this.toolMap = opts.toolMap;
            this.allToolDefs = opts.allToolDefs;
        }
        this.boundModel = (this.chatModel as any).bindTools(this.allToolDefs);
    }

    async run(
        messages: Array<Record<string, unknown>>,
    ): Promise<[string | null, Record<string, unknown>]> {
        const loopStart = performance.now();

        for (let roundNum = 0; roundNum < this.maxToolRounds; roundNum++) {
            const activeModel = this.pickModel(roundNum);
            let aiMsg: any;
            try {
                const llmStart = performance.now();
                aiMsg = await activeModel.invoke(messages, {
                    temperature: this.temperature,
                });
                const llmElapsed = performance.now() - llmStart;
                console.info(
                    `[PERF][agent=${this.agentName}][loop] round=${roundNum + 1} ` +
                        `LLM call took ${llmElapsed.toFixed(1)} ms ` +
                        `(tool_calls=${(aiMsg.tool_calls || []).length})`,
                );
            } catch (exc: unknown) {
                console.error(
                    `[${this.agentName}] LLM error in round ${roundNum + 1}: ${String(exc)}`,
                );
                return [`[Error] LLM call failed: ${String(exc)}`, this.toolResults];
            }

            messages.push(aiMsg);
            const toolCalls = aiMsg.tool_calls || [];

            if (toolCalls.length === 0) {
                const finalText: string = extractTextContent(aiMsg.content);
                const totalElapsed = performance.now() - loopStart;
                console.info(
                    `[PERF][agent=${this.agentName}][loop] DONE rounds=${roundNum + 1} ` +
                        `total=${totalElapsed.toFixed(0)}ms`,
                );
                return [finalText, this.toolResults];
            }

            const dispatchStart = performance.now();
            // Filter out undefined tool calls to prevent crashes
            const validToolCalls = (toolCalls || []).filter((tc: any) => tc != null);
            if (validToolCalls.length === 0) {
                console.warn(`[${this.agentName}] No valid tool calls to dispatch`);
            } else {
                await this.dispatchToolCalls(validToolCalls, messages, roundNum);
            }
            const dispatchElapsed = performance.now() - dispatchStart;
            console.info(
                `[PERF][agent=${this.agentName}][loop] round=${roundNum + 1} ` +
                    `tool dispatch took ${dispatchElapsed.toFixed(1)} ms`,
            );
        }

        console.warn(`[${this.agentName}] Hit max tool rounds (${this.maxToolRounds})`);
        return [null, this.toolResults];
    }

    // ── Private helpers ────────────────────────────────────────────

    private pickModel(_roundNum: number): any {
        if (this.consecutiveDupes >= this.maxConsecutiveDupes) {
            console.warn(
                `[${this.agentName}] ${this.consecutiveDupes} consecutive dupes — forcing text-only response`,
            );
            return this.chatModel;
        }
        return this.boundModel;
    }

    private unpack(tc: any): {
        fnName: string;
        fnArgs: Record<string, unknown>;
        tcId: string;
        callKey: string;
    } {
        if (!tc) {
            return { fnName: "", fnArgs: {}, tcId: "", callKey: "" };
        }
        const fnName = tc.name || tc.function?.name || "";
        let fnArgs = tc.args || tc.function?.arguments || {};
        if (typeof fnArgs === "string") {
            try {
                return this.unpack({ ...tc, args: JSON.parse(fnArgs) });
            } catch {
                fnArgs = {};
            }
        }
        if (!fnArgs || typeof fnArgs !== "object") {
            fnArgs = {};
        }
        const tcId = tc.id || "";
        const sortedKeys = Object.keys(fnArgs || {}).sort();
        const sortedArgs: Record<string, unknown> = {};
        for (const k of sortedKeys) sortedArgs[k] = fnArgs[k];
        const callKey = `${fnName}|${JSON.stringify(sortedArgs)}`;
        return { fnName, fnArgs, tcId, callKey };
    }

    private requiresApproval(tc: any): boolean {
        const tool = this.toolMap.get(tc.name || tc.function?.name || "");
        return !!tool?.requiresApproval;
    }

    private isEligibleForParallel(fnName: string, callKey: string): boolean {
        if (!isParallelSafe(fnName, this.parallelSafety)) return false;
        if (!this.toolMap.has(fnName)) return false;
        if (this.seenCalls.has(callKey)) return false;
        if (this.toolMap.get(fnName)!.requiresApproval) return false;
        return true;
    }

    private async dispatchToolCalls(
        toolCalls: any[],
        messages: any[],
        roundNum: number,
    ): Promise<void> {
        const anyApproval = toolCalls.some((tc) => this.requiresApproval(tc));
        if (this.parallelSafety === null || anyApproval) {
            await this.dispatchSequential(toolCalls, messages, roundNum);
        } else {
            await this.dispatchMixed(toolCalls, messages, roundNum);
        }
    }

    private async dispatchSequential(
        toolCalls: any[],
        messages: any[],
        roundNum: number,
    ): Promise<void> {
        for (const tc of toolCalls) {
            const { fnName, fnArgs, tcId, callKey } = this.unpack(tc);
            console.info(`[${this.agentName}] Tool call #${roundNum + 1} -> ${fnName}`);
            this.events.push(
                makeEvent("tool.started", {
                    agent: this.agentName,
                    tool: fnName,
                    args: fnArgs,
                }),
            );
            const resultText = await this.executeOne(fnName, fnArgs, callKey, roundNum);
            this.events.push(
                makeEvent("tool.finished", {
                    agent: this.agentName,
                    tool: fnName,
                    resultPreview: resultText.slice(0, 200),
                }),
            );
            this.toolResults[fnName] = resultText;
            messages.push({
                role: "tool",
                content: resultText,
                tool_call_id: tcId,
            });
        }
    }

    private async dispatchMixed(
        toolCalls: any[],
        messages: any[],
        roundNum: number,
    ): Promise<void> {
        const parallel: number[] = [];
        const sequential: number[] = [];
        // Filter out undefined tool calls and ensure unpacked is always an array
        const unpacked = (toolCalls || []).filter((tc) => tc != null).map((tc) => this.unpack(tc));

        for (let i = 0; i < unpacked.length; i++) {
            const { fnName, callKey } = unpacked[i];
            if (this.isEligibleForParallel(fnName, callKey)) parallel.push(i);
            else sequential.push(i);
        }

        const results: (string | null)[] = new Array(unpacked.length).fill(null);

        if (parallel.length > 0) {
            for (const i of parallel) {
                const { fnName, fnArgs } = unpacked[i];
                this.events.push(
                    makeEvent("tool.started", {
                        agent: this.agentName,
                        tool: fnName,
                        args: fnArgs,
                    }),
                );
            }

            const gatherStart = performance.now();
            const coros = parallel.map((i) =>
                this.executeParallelLeg(
                    unpacked[i].fnName,
                    unpacked[i].fnArgs,
                    unpacked[i].callKey,
                ),
            );
            const gathered = await Promise.allSettled(coros);
            const gatherElapsed = performance.now() - gatherStart;
            console.info(
                `[PERF][agent=${this.agentName}][loop] round=${roundNum + 1} ` +
                    `parallel_gather n=${parallel.length} took ${gatherElapsed.toFixed(1)} ms`,
            );

            for (let slot = 0; slot < parallel.length; slot++) {
                const idx = parallel[slot];
                const { fnName } = unpacked[idx];
                const outcome = gathered[slot];
                const text =
                    outcome.status === "fulfilled"
                        ? outcome.value
                        : `[Tool error] ${String(outcome.reason)}`;
                this.events.push(
                    makeEvent("tool.finished", {
                        agent: this.agentName,
                        tool: fnName,
                        resultPreview: text.slice(0, 200),
                    }),
                );
                results[idx] = text;
                this.toolResults[fnName] = text;
            }
        }

        for (const idx of sequential) {
            const { fnName, fnArgs, callKey } = unpacked[idx];
            console.info(
                `[${this.agentName}] Tool call #${roundNum + 1} -> ${fnName} (sequential)`,
            );
            this.events.push(
                makeEvent("tool.started", {
                    agent: this.agentName,
                    tool: fnName,
                    args: fnArgs,
                }),
            );
            const text = await this.executeOne(fnName, fnArgs, callKey, roundNum);
            this.events.push(
                makeEvent("tool.finished", {
                    agent: this.agentName,
                    tool: fnName,
                    resultPreview: text.slice(0, 200),
                }),
            );
            results[idx] = text;
            this.toolResults[fnName] = text;
        }

        for (let i = 0; i < toolCalls.length; i++) {
            messages.push({
                role: "tool",
                content: results[i] || "",
                tool_call_id: unpacked[i].tcId,
            });
        }
    }

    private async executeOne(
        fnName: string,
        fnArgs: Record<string, unknown>,
        callKey: string,
        roundNum: number,
    ): Promise<string> {
        if (this.seenCalls.has(callKey)) {
            return this.handleDuplicate(callKey, fnName, roundNum);
        }
        if (this.toolMap.has(fnName)) {
            return await this.dispatchSingle(fnName, fnArgs, callKey);
        }
        console.error(`[${this.agentName}] Unknown tool '${fnName}'`);
        return `[Error] Unknown tool '${fnName}'`;
    }

    private async executeParallelLeg(
        fnName: string,
        fnArgs: Record<string, unknown>,
        callKey: string,
    ): Promise<string> {
        return await this.dispatchSingle(fnName, fnArgs, callKey);
    }

    private handleDuplicate(callKey: string, fnName: string, roundNum: number): string {
        this.consecutiveDupes++;
        console.warn(
            `[${this.agentName}] Duplicate call #${roundNum + 1} -> ${fnName} ` +
                `(${this.consecutiveDupes} consecutive)`,
        );
        return (
            "You already called this tool with the same parameters. " +
            "Here is the previous result (do NOT call it again — " +
            "summarise this data for the user instead):\n\n" +
            this.seenCalls.get(callKey)
        );
    }

    private async dispatchSingle(
        fnName: string,
        fnArgs: Record<string, unknown>,
        callKey: string,
    ): Promise<string> {
        this.consecutiveDupes = 0;
        const tool = this.toolMap.get(fnName)!;
        const toolKind = tool.constructor.name;

        if (tool.requiresApproval) {
            console.info(`[${this.agentName}] Tool '${fnName}' requires approval`);
            const decision = await this.requestApproval(fnName, fnArgs);
            if (!decision?.approved) return "Tool execution cancelled by user.";
        }

        const invokeStart = performance.now();
        let resultText: string;
        try {
            resultText = await tool.invoke(fnArgs);
        } catch (exc: unknown) {
            resultText = `[Tool error] ${String(exc)}`;
        }
        const invokeElapsed = performance.now() - invokeStart;
        const isError = resultText.startsWith("[Tool error]");
        console.info(
            `[PERF][agent=${this.agentName}][tool] ${toolKind} name=${fnName} ` +
                `took ${invokeElapsed.toFixed(0)}ms (error=${isError})`,
        );
        if (!isError) this.seenCalls.set(callKey, resultText);
        return resultText;
    }

    private async requestApproval(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<{ approved?: boolean } | null> {
        try {
            throw new GraphInterrupt({
                toolName,
                arguments: args,
                agentName: this.agentName,
            });
        } catch (e: unknown) {
            if (
                e instanceof Error &&
                "interruptValue" in (e as any) &&
                (e as any).interruptValue?.toolName === toolName
            ) {
                throw e;
            }
            return null;
        }
    }
}
