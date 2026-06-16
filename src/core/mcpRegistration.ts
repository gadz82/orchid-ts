/** Per-server dynamic-client-registration metadata (RFC 7591 + RFC 8414). */

export class OrchidMCPClientRegistration {
    serverName: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint: string;
    issuer: string;
    scopesSupported: string;
    tokenEndpointAuthMethodsSupported: string;
    clientId: string;
    clientSecret: string;
    clientIdIssuedAt: number;
    clientSecretExpiresAt: number;
    createdAt: number;
    updatedAt: number;

    constructor({
        serverName,
        authorizationEndpoint,
        tokenEndpoint,
        registrationEndpoint = "",
        issuer = "",
        scopesSupported = "",
        tokenEndpointAuthMethodsSupported = "client_secret_post",
        clientId = "",
        clientSecret = "",
        clientIdIssuedAt = 0.0,
        clientSecretExpiresAt = 0.0,
    }: {
        serverName: string;
        authorizationEndpoint: string;
        tokenEndpoint: string;
        registrationEndpoint?: string;
        issuer?: string;
        scopesSupported?: string;
        tokenEndpointAuthMethodsSupported?: string;
        clientId?: string;
        clientSecret?: string;
        clientIdIssuedAt?: number;
        clientSecretExpiresAt?: number;
    }) {
        this.serverName = serverName;
        this.authorizationEndpoint = authorizationEndpoint;
        this.tokenEndpoint = tokenEndpoint;
        this.registrationEndpoint = registrationEndpoint;
        this.issuer = issuer;
        this.scopesSupported = scopesSupported;
        this.tokenEndpointAuthMethodsSupported = tokenEndpointAuthMethodsSupported;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.clientIdIssuedAt = clientIdIssuedAt;
        this.clientSecretExpiresAt = clientSecretExpiresAt;
        this.createdAt = Date.now() / 1000;
        this.updatedAt = this.createdAt;
    }

    get usesBasicAuth(): boolean {
        return this.tokenEndpointAuthMethodsSupported.includes("client_secret_basic");
    }

    get isPublicClient(): boolean {
        return !this.clientSecret;
    }
}

export abstract class OrchidMCPClientRegistrationStore {
    abstract initDb(): Promise<void>;
    abstract close(): Promise<void>;

    abstract get(serverName: string): Promise<OrchidMCPClientRegistration | null>;
    abstract save(record: OrchidMCPClientRegistration): Promise<void>;
    abstract delete(serverName: string): Promise<boolean>;
}
