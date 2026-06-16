/** Identity conformance validation. */
import type { OrchidAuthContext } from "./state.js";

export class IdentityConformanceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "IdentityConformanceError";
    }
}

export interface ConformanceResult {
    valid: boolean;
    missing: string[];
    errors: string[];
}

export function validateIdentityConformance(
    auth: OrchidAuthContext,
    requiredClaims: string[] = [],
): ConformanceResult {
    const missing: string[] = [];
    const errors: string[] = [];

    if (!auth.tenantKey) {
        missing.push("tenant_key");
        errors.push("Missing required identity claim: tenant_key");
    }
    if (!auth.userId) {
        missing.push("user_id");
        errors.push("Missing required identity claim: user_id");
    }
    if (!auth.accessToken) {
        missing.push("access_token");
        errors.push("Missing required identity claim: access_token");
    }

    for (const claim of requiredClaims) {
        if (!(auth.extra as Record<string, unknown>)[claim]) {
            missing.push(claim);
            errors.push(`Missing required identity claim: ${claim}`);
        }
    }

    return {
        valid: errors.length === 0,
        missing,
        errors,
    };
}
