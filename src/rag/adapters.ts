import type { OrchidDocument } from "../core/repository.js";

export function toLangchainDocument(doc: OrchidDocument): {
    id?: string;
    pageContent: string;
    metadata: Record<string, unknown>;
} {
    return {
        id: doc.id,
        pageContent: doc.pageContent,
        metadata: { ...(doc.metadata || {}) },
    };
}

export function fromLangchainDocument(doc: {
    pageContent?: string;
    page_content?: string;
    metadata?: Record<string, unknown>;
    id?: string;
}): OrchidDocument {
    return {
        id: doc.id,
        pageContent: doc.pageContent ?? doc.page_content ?? "",
        metadata: { ...(doc.metadata || {}) },
    };
}

export function toLangchainDocuments(
    docs: OrchidDocument[],
): { id?: string; pageContent: string; metadata: Record<string, unknown> }[] {
    return docs.map(toLangchainDocument);
}

export function fromLangchainDocuments(
    docs: {
        pageContent?: string;
        page_content?: string;
        metadata?: Record<string, unknown>;
        id?: string;
    }[],
): OrchidDocument[] {
    return docs.map(fromLangchainDocument);
}
