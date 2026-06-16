/** Barrel export for the observability sub-package. */

export { OrchidEventBus } from "./eventBus.js";
export type { EventListener } from "./eventBus.js";

export { OrchidMetricsHandler } from "./callbacks.js";

export {
    MINI_AGENT_EVENT_KEY,
    makeEventMessage,
    extractEvent,
    isEventMessage,
} from "./miniAgentEvents.js";
export type { MiniAgentEventName } from "./miniAgentEvents.js";

export { PERF_LOGGER_NAME, configurePerfLogger } from "./perf.js";
