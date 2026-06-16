/** MCP Gateway State ABCs — inbound gateway OAuth state persistence. */

export interface OrchidMCPGatewayClient {
    clientId: string;
    clientSecret?: string;
    redirectUris: string[];
    grantTypes?: string[];
    tokenEndpointAuthMethod?: string;
    scope?: string;
    tenantId?: string;
    metadata?: Record<string, unknown>;
    createdAt?: number;
}

export interface OrchidMCPGatewayAuthCode {
    code: string;
    clientId: string;
    redirectUri: string;
    scope?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    upstreamState?: string;
    tenantId?: string;
    userId?: string;
    idpAccessToken?: string;
    idpRefreshToken?: string;
    idpExpiresAt?: number;
    expiresAt: number;
    consumed: boolean;
    createdAt?: number;
}

export interface OrchidMCPGatewayToken {
    accessToken: string;
    refreshToken?: string;
    clientId: string;
    scope?: string;
    tenantId?: string;
    userId?: string;
    idpAccessToken?: string;
    idpRefreshToken?: string;
    idpExpiresAt?: number;
    expiresAt?: number;
    createdAt?: number;
}

export abstract class OrchidMCPGatewayClientStore {
    abstract initDb(): Promise<void>;
    abstract close(): Promise<void>;

    abstract register(client: OrchidMCPGatewayClient): Promise<OrchidMCPGatewayClient>;
    abstract get(clientId: string): Promise<OrchidMCPGatewayClient | null>;
}

export abstract class OrchidMCPGatewayAuthCodeStore {
    abstract initDb(): Promise<void>;
    abstract close(): Promise<void>;

    abstract put(authCode: OrchidMCPGatewayAuthCode): Promise<void>;
    abstract getByUpstreamState(upstreamState: string): Promise<OrchidMCPGatewayAuthCode | null>;
    abstract update(code: string, patch: Partial<OrchidMCPGatewayAuthCode>): Promise<void>;
    abstract consume(code: string): Promise<OrchidMCPGatewayAuthCode | null>;
}

export abstract class OrchidMCPGatewayTokenStore {
    abstract initDb(): Promise<void>;
    abstract close(): Promise<void>;

    abstract issue(token: OrchidMCPGatewayToken): Promise<OrchidMCPGatewayToken>;
    abstract getByAccessToken(accessTokenHash: string): Promise<OrchidMCPGatewayToken | null>;
    abstract getByRefreshToken(refreshTokenHash: string): Promise<OrchidMCPGatewayToken | null>;
    abstract revoke(accessTokenHash: string): Promise<boolean>;
}
