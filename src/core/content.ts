/** Content source descriptor — what persistent content an agent draws from. */

export interface OrchidContentItem {
    path: string;
    name: string;
    contentType: string;
    metadata: Record<string, unknown>;
    content: string | null;
}

export interface OrchidContentSource {
    type: string;
    uri: string;
    description?: string;
    list(opts?: {
        path?: string;
        recursive?: boolean;
        limit?: number;
    }): Promise<Array<Record<string, unknown>>>;
    get(path: string): Promise<Record<string, unknown>>;
    search(opts: {
        query: string;
        recursive?: boolean;
        limit?: number;
    }): Promise<Array<Record<string, unknown>>>;
}
