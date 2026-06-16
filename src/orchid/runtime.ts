export class OrchidRuntime {
    config?: any;
    defaultModel: string = "";
    chatModel: any | null = null;
    reader: any | null = null;
    writer: any | null = null;
    docStore: any | null = null;
    graphStore: any | null = null;
    sparseEncoder: any | null = null;
    chatStorage: any | null = null;
    mcpClientFactory: ((server: any) => any) | null = null;
    mcpTokenStore: any | null = null;
    mcpClientRegistrationStore: any | null = null;
    mcpGatewayStateStore: any | null = null;
    checkpointer: any | null = null;
    contentSources: any[] | null = null;
    uploadNamespace: string = "uploads";
    allowedPassthroughHosts: string[] = [];
    signalEmitter: any | null = null;
    mcpAuthRegistry: any | null = null;

    constructor(fields?: Partial<OrchidRuntime>) {
        if (fields) Object.assign(this, fields);
    }

    getReader(): any {
        return this.reader ?? null;
    }

    getChatModel(): any {
        return this.chatModel;
    }

    getDocStore(): any {
        return this.docStore ?? null;
    }

    getGraphStore(): any {
        return this.graphStore ?? null;
    }

    getSparseEncoder(): any {
        return this.sparseEncoder ?? null;
    }

    getMcpClientFactory(): any {
        return this.mcpClientFactory;
    }
}
