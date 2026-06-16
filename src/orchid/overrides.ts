export class StorageOverrides {
    chatStorageClass: string = "";
    chatDbDsn: string = "";
    chatExtraMigrationsPackage: string | null = null;
}

export class MCPStorageOverrides {
    mcpTokenStoreClass: string = "";
    mcpTokenStoreDsn: string = "";
    mcpClientRegistrationStoreClass: string = "";
    mcpClientRegistrationStoreDsn: string = "";
    mcpGatewayStateStoreClass: string = "";
    mcpGatewayStateStoreDsn: string = "";
}

export class CheckpointerOverrides {
    checkpointerType: string = "";
    checkpointerDsn: string = "";
}

export class StartupOverrides {
    startupHook: string = "";
    startupHookKwargs: Record<string, unknown> = {};
}

export class OrchidFactoryOverrides {
    model: string = "";
    vectorBackend: string = "";
    qdrantUrl: string = "";
    embeddingModel: string = "";
    storage: StorageOverrides = new StorageOverrides();
    mcpStorage: MCPStorageOverrides = new MCPStorageOverrides();
    checkpointer: CheckpointerOverrides = new CheckpointerOverrides();
    startup: StartupOverrides = new StartupOverrides();
    contentSources: any[] | null = null;
    runtimeOverrides: Record<string, unknown> = {};
    skipYamlSections: Set<string> = new Set();

    constructor(fields?: Record<string, unknown>) {
        if (fields) Object.assign(this, fields);
    }
}
