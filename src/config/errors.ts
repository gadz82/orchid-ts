export class OrchidConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OrchidConfigError";
    }
}

export class ConfigLoadError extends OrchidConfigError {
    constructor(
        message: string,
        public readonly path?: string,
    ) {
        super(message);
        this.name = "ConfigLoadError";
    }
}

export class ConfigValidationError extends OrchidConfigError {
    constructor(
        message: string,
        public readonly zodErrors: Array<{ path: string; message: string }> = [],
    ) {
        super(message);
        this.name = "ConfigValidationError";
    }
}

export class AgentNotFoundError extends OrchidConfigError {
    constructor(agentName: string) {
        super(`Agent '${agentName}' not found in configuration`);
        this.name = "AgentNotFoundError";
    }
}
