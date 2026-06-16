/** Auth config provider and exchange client ABCs. */

export interface OrchidUpstreamOAuthConfig {
    domain: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    scopes: string;
    clientId: string;
    clientSecret?: string;
    refreshViaApi: boolean;
}

export abstract class OrchidAuthConfigProvider {
    abstract resolveConfig(): OrchidUpstreamOAuthConfig;
}

export abstract class OrchidAuthExchangeClient {
    abstract exchangeCode(
        code: string,
        redirectUri: string,
        codeVerifier?: string,
    ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>;

    async refreshToken(_refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
        throw new Error(`refreshToken not implemented in ${this.constructor.name}`);
    }
}
