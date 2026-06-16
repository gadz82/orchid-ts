/** Per-user MCP OAuth token persistence contract. */

export abstract class OrchidTokenSerializer {
    abstract encrypt(plaintext: string): string;
    abstract decrypt(ciphertext: string): string;
}

export class OrchidMCPTokenRecord {
    serverName: string;
    tenantId: string;
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string;
    createdAt: number;
    updatedAt: number;

    constructor({
        serverName,
        tenantId,
        userId,
        accessToken,
        refreshToken = "",
        expiresAt = 0.0,
        scopes = "",
    }: {
        serverName: string;
        tenantId: string;
        userId: string;
        accessToken: string;
        refreshToken?: string;
        expiresAt?: number;
        scopes?: string;
    }) {
        this.serverName = serverName;
        this.tenantId = tenantId;
        this.userId = userId;
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.expiresAt = expiresAt;
        this.scopes = scopes;
        this.createdAt = Date.now() / 1000;
        this.updatedAt = this.createdAt;
    }

    get isExpired(): boolean {
        return this.expiresAt > 0 && Date.now() / 1000 >= this.expiresAt;
    }

    get isRefreshAvailable(): boolean {
        return this.refreshToken.length > 0;
    }

    get bearerHeader(): Record<string, string> {
        return { Authorization: `Bearer ${this.accessToken}` };
    }
}

export abstract class OrchidMCPTokenStore {
    abstract initDb(): Promise<void>;
    abstract close(): Promise<void>;

    abstract getToken(
        tenantId: string,
        userId: string,
        serverName: string,
    ): Promise<OrchidMCPTokenRecord | null>;

    abstract saveToken(record: OrchidMCPTokenRecord): Promise<void>;

    abstract deleteToken(tenantId: string, userId: string, serverName: string): Promise<boolean>;

    abstract listTokens(tenantId: string, userId: string): Promise<OrchidMCPTokenRecord[]>;

    async cleanupExpired(_before?: number): Promise<number> {
        return 0;
    }
}
