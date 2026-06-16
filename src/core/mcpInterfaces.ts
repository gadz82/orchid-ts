/**
 * Abstract interfaces for MCP clients — Interface Segregation.
 *
 * OrchidMCPToolCaller: for code that only calls tools.
 * OrchidMCPDiscoverable: for code that discovers capabilities.
 * OrchidMCPClient: combined interface.
 */
import type { OrchidAuthContext } from "./state.js";
import type { OrchidMCPToolResult } from "./mcpResult.js";

export abstract class OrchidMCPToolCaller {
    abstract get serverUrl(): string;

    abstract callTool(
        toolName: string,
        arguments_: Record<string, unknown>,
        auth: OrchidAuthContext,
    ): Promise<OrchidMCPToolResult>;
}

export abstract class OrchidMCPDiscoverable {
    abstract listTools(auth: OrchidAuthContext): Promise<Record<string, unknown>[]>;
    abstract listPrompts(auth: OrchidAuthContext): Promise<Record<string, unknown>[]>;
    abstract listResources(auth: OrchidAuthContext): Promise<Record<string, unknown>[]>;
    abstract getPrompt(
        name: string,
        arguments_: Record<string, string>,
        auth: OrchidAuthContext,
    ): Promise<Record<string, unknown>[]>;
    abstract readResource(uri: string, auth: OrchidAuthContext): Promise<string>;
}

export abstract class OrchidMCPClient extends OrchidMCPToolCaller {
    // Combines both interfaces — use OrchidMCPToolCaller directly for better segregation
}

export abstract class OrchidCacheableMCPClient extends OrchidMCPClient {
    abstract invalidateCache(): void;
    abstract warmCache(auth: OrchidAuthContext): Promise<void>;
}
