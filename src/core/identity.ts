/** Abstract identity resolution — consumers provide concrete implementations. */
import type { OrchidAuthContext } from "./state.js";

export abstract class OrchidIdentityResolver {
    abstract resolve(domain: string, bearerToken: string): Promise<OrchidAuthContext>;

    async resolveServiceAccount(name: string): Promise<OrchidAuthContext> {
        throw new OrchidServiceAccountUnknownError(name);
    }

    async mintForUser(_tenantKey: string, _userId: string): Promise<OrchidAuthContext> {
        throw new MintingProbeUnsupportedError(this.constructor.name);
    }
}

export class OrchidIdentityError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 0) {
        super(message);
        this.name = "OrchidIdentityError";
        this.statusCode = statusCode;
    }
}

export class OrchidServiceAccountUnknownError extends OrchidIdentityError {
    constructor(name: string) {
        super(`Unknown service account: ${name}`);
        this.name = "OrchidServiceAccountUnknownError";
    }
}

export class MintingProbeUnsupportedError extends OrchidIdentityError {
    constructor(resolverName: string) {
        super(`Identity resolver '${resolverName}' does not support minting`);
        this.name = "MintingProbeUnsupportedError";
    }
}
