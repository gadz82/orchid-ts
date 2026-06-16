/** MCP client error types. */

export class OrchidMCPAuthRequiredError extends Error {
    serverName: string;

    constructor(serverName: string) {
        super(`OAuth authorization required for MCP server '${serverName}'`);
        this.name = "OrchidMCPAuthRequiredError";
        this.serverName = serverName;
    }
}

export class OrchidMCPDiscoveryError extends Error {
    serverName: string;
    reason: string;

    constructor(serverName: string, reason: string) {
        super(`MCP authorization discovery failed for '${serverName}': ${reason}`);
        this.name = "OrchidMCPDiscoveryError";
        this.serverName = serverName;
        this.reason = reason;
    }
}
