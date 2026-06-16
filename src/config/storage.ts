export abstract class OrchidConfigStorage {
    abstract initDb(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listConfigs(): Promise<
        Array<{
            name: string;
            config: Record<string, unknown>;
            createdAt: string;
            updatedAt: string;
        }>
    >;
    abstract getConfig(name: string): Promise<{
        name: string;
        config: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    } | null>;
    abstract upsertConfig(
        name: string,
        config: Record<string, unknown>,
    ): Promise<{
        name: string;
        config: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    }>;
    abstract patchConfig(
        name: string,
        patch: Record<string, unknown>,
    ): Promise<{
        name: string;
        config: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    } | null>;
    abstract deleteConfig(name: string): Promise<void>;
}
