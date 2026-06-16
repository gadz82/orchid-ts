/**
 * Lightweight perf-logging toggle.
 *
 * When enabled the graph wrapper, agentic loop, and MCP dispatcher
 * emit timing logs at key junctures (LLM round-trip, tool dispatch,
 * aggregation) so integrators can profile without a full tracing stack.
 *
 * Controlled via environment variable ORCHID_ENABLE_PERF_LOGS (any
 * truthy value).
 */

const PERF_ENV = "ORCHID_ENABLE_PERF_LOGS";

export const PERF_LOGGER_NAME = "orchid.perf";

let _enabled: boolean | null = null;

/**
 * Read (and cache) the perf-logging toggle from the environment.
 * Callers may pass `enabled` explicitly to override the env var for
 * the lifetime of the process.
 */
export function configurePerfLogger(enabled?: boolean): boolean {
    if (enabled !== undefined) {
        _enabled = enabled;
        return _enabled;
    }

    if (_enabled !== null) {
        return _enabled;
    }

    try {
        const raw = process.env[PERF_ENV];
        if (raw === undefined || raw === null) {
            _enabled = false;
        } else if (raw === "") {
            _enabled = true;
        } else {
            const lower = raw.trim().toLowerCase();
            _enabled = lower === "1" || lower === "true" || lower === "yes" || lower === "on";
        }
    } catch {
        _enabled = false;
    }

    return _enabled;
}
