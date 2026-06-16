/** Public surface for mcp/ — MCP client, inventory, auth registry, discovery, session warmer. */

export { MCPToolAnnotations, OrchidMCPServerEntry, OrchidMCPServerInventory } from "./inventory.js";
export type { OrchidMCPAuthMode } from "./inventory.js";

export { OrchidMCPOAuthServerInfo, OrchidMCPAuthRegistry } from "./authRegistry.js";

export { InMemoryOAuthStateStore } from "./oauthState.js";
export type { OrchidOAuthStateStore } from "./oauthState.js";

export { OrchidMCPAuthDiscovery } from "./discovery.js";

export { OrchidSessionWarmer } from "./sessionWarmer.js";
export type { OrchidWarmReport } from "./sessionWarmer.js";

export { StreamableHttpMCPClient } from "./client.js";
