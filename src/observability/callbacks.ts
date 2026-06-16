/**
 * Simple in-process metrics accumulator — counts LLM calls, tool calls,
 * retries, and token usage across agent runs.
 *
 * This is NOT a distributed-metrics facade; it is a lightweight, zero-dep
 * accumulator that the graph wrapper, agentic loop, and MCP dispatcher
 * increment.  Integrators can read it after a run, reset it between runs,
 * or attach external exporters.
 */

export class OrchidMetricsHandler {
    private _metrics = {
        llmCalls: 0,
        llmErrors: 0,
        toolCalls: 0,
        retries: 0,
        totalTokens: 0,
        perAgentLatency: {} as Record<string, number>,
    };

    onLlmStart(_agentName: string): void {
        this._metrics.llmCalls++;
    }

    onLlmEnd(agentName: string, tokens: number, latencyMs: number): void {
        this._metrics.totalTokens += tokens;
        const prev = this._metrics.perAgentLatency[agentName] ?? 0;
        this._metrics.perAgentLatency[agentName] = prev + latencyMs;
    }

    onLlmError(_agentName: string): void {
        this._metrics.llmErrors++;
    }

    onToolEnd(agentName: string, _toolName: string): void {
        this._metrics.toolCalls++;
        // Ensure the agent has a latency entry even if no LLM call was tracked
        if (!(agentName in this._metrics.perAgentLatency)) {
            this._metrics.perAgentLatency[agentName] = 0;
        }
    }

    onRetry(_agentName: string): void {
        this._metrics.retries++;
    }

    getMetrics(): Record<string, unknown> {
        return {
            llm_calls: this._metrics.llmCalls,
            llm_errors: this._metrics.llmErrors,
            tool_calls: this._metrics.toolCalls,
            retries: this._metrics.retries,
            total_tokens: this._metrics.totalTokens,
            per_agent_latency_ms: { ...this._metrics.perAgentLatency },
        };
    }

    reset(): void {
        this._metrics = {
            llmCalls: 0,
            llmErrors: 0,
            toolCalls: 0,
            retries: 0,
            totalTokens: 0,
            perAgentLatency: {},
        };
    }
}
