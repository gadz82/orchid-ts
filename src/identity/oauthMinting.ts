/**
 * Thin utility: upstream bearer token → fresh OrchidAuthContext.
 *
 * Delegates to the configured OrchidIdentityResolver so that the graph
 * can obtain an identity-context scoped to a target service account or
 * role, given only the caller's existing upstream bearer.
 *
 * This is specifically for the identity-bridge pathway ("mint an Orchid
 * token from a platform token"), NOT for bearer-validation at the API
 * entry point (that is OrchidIdentityResolver.resolve).
 */

import type { OrchidIdentityResolver } from "../core/identity.js";

export interface OAuthMintingResult {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
}

/**
 * Mint a fresh Orchid-signed access token (and optional refresh token)
 * using the configured identity resolver's minting bridge.
 *
 * @param opts.identityResolver — a concrete OrchidIdentityResolver subclass.
 * @param opts.upstreamToken   — the caller's existing upstream bearer.
 * @param opts.scope           — optional scope string for the minted token.
 * @param opts.chatId          — optional chat identifier for scoping.
 */
export async function mintOAuthToken(opts: {
    identityResolver: OrchidIdentityResolver;
    upstreamToken: string;
    scope?: string;
    chatId?: string;
}): Promise<OAuthMintingResult> {
    const { identityResolver, scope, chatId } = opts;

    const authCtx = await identityResolver.mintForUser(scope ?? "", chatId ?? "");

    if (!authCtx.accessToken) {
        throw new Error(
            "Identity resolver mintForUser returned an auth context with no access token",
        );
    }

    const result: OAuthMintingResult = {
        accessToken: authCtx.accessToken,
        tokenType: "Bearer",
    };

    const ctx = authCtx as unknown as Record<string, unknown>;
    if (typeof ctx["refreshToken"] === "string") {
        result.refreshToken = ctx["refreshToken"] as string;
    }
    if (typeof ctx["expiresIn"] === "number") {
        result.expiresIn = ctx["expiresIn"] as number;
    }
    if (typeof ctx["tokenType"] === "string") {
        result.tokenType = ctx["tokenType"] as string;
    }

    return result;
}
