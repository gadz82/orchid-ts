/** Event system error hierarchy. */

export class OrchidEventsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OrchidEventsError";
    }
}

export class SignalDuplicateError extends OrchidEventsError {
    constructor(message: string) {
        super(message);
        this.name = "SignalDuplicateError";
    }
}

export class SignalSourceUnknownError extends OrchidEventsError {
    constructor(name: string) {
        super(`Unknown signal source: ${name}`);
        this.name = "SignalSourceUnknownError";
    }
}

export class SignalSourceTypeNotAllowedError extends OrchidEventsError {
    constructor(type: string) {
        super(`Signal type not allowed: ${type}`);
        this.name = "SignalSourceTypeNotAllowedError";
    }
}

export class SignalAuthValidationError extends OrchidEventsError {
    constructor(message: string) {
        super(message);
        this.name = "SignalAuthValidationError";
    }
}

export class TriggerRegistrationError extends OrchidEventsError {
    constructor(message: string) {
        super(message);
        this.name = "TriggerRegistrationError";
    }
}

export class TriggerMatchError extends OrchidEventsError {
    constructor(message: string) {
        super(message);
        this.name = "TriggerMatchError";
    }
}

export class JobRunnerError extends OrchidEventsError {
    retryable: boolean;

    constructor(message: string, retryable = false) {
        super(message);
        this.name = "JobRunnerError";
        this.retryable = retryable;
    }
}

export class OrchidServiceAccountUnknownError extends OrchidEventsError {
    name: string;

    constructor(name: string) {
        super(`Unknown service account: ${name}`);
        this.name = "OrchidServiceAccountUnknownError";
        this.name = name;
    }
}

export class OrchidIdentityNotMintableError extends OrchidEventsError {
    tenantKey: string;
    userId: string;

    constructor(tenantKey: string, userId: string) {
        super(`Cannot mint identity for ${tenantKey}:${userId}`);
        this.name = "OrchidIdentityNotMintableError";
        this.tenantKey = tenantKey;
        this.userId = userId;
    }
}

export class MintingProbeUnsupportedError extends OrchidIdentityNotMintableError {
    resolverClass: string;

    constructor(resolverClass: string) {
        super("__probe__", "__probe__");
        this.name = "MintingProbeUnsupportedError";
        this.resolverClass = resolverClass;
    }
}

export class ChatBindingError extends OrchidEventsError {
    constructor(message: string) {
        super(message);
        this.name = "ChatBindingError";
    }
}

export class ChatBindingTargetNotFoundError extends ChatBindingError {
    chatId: string;

    constructor(chatId: string) {
        super(`Chat-binding target chat '${chatId}' not found`);
        this.chatId = chatId;
    }
}

export class ChatBindingForbiddenError extends ChatBindingError {
    chatId: string;
    userId: string;

    constructor(chatId: string, userId: string) {
        super(`Auth user '${userId}' cannot write to chat '${chatId}'`);
        this.chatId = chatId;
        this.userId = userId;
    }
}
