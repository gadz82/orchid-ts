export const KNOWN_DIMS: Record<string, number> = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    "bedrock/amazon.titan-embed-text-v2:0": 1024,
    "ollama/nomic-embed-text": 768,
    "gemini/gemini-embedding-001": 3072,
    "gemini/gemini-embedding-2-preview": 3072,
};

const BATCH_LIMITS: Record<string, number> = {
    "gemini/": 80,
    "google/": 80,
    "cohere/": 80,
    "voyage/": 100,
    "bedrock/cohere.": 80,
    "text-embedding-3-small": 2000,
    "text-embedding-3-large": 2000,
    "text-embedding-ada-002": 2000,
};

const PROVIDER_MAP: Array<[string, string, string, string | null]> = [
    ["ollama/", "@langchain/ollama", "OllamaEmbeddings", "ollama/"],
    ["gemini/", "@langchain/google-genai", "GoogleGenerativeAIEmbeddings", "gemini/"],
    ["google/", "@langchain/google-genai", "GoogleGenerativeAIEmbeddings", "google/"],
];

export function getEmbeddingDimension(model: string): number {
    return KNOWN_DIMS[model] ?? 1536;
}

export function getEmbeddingBatchSize(model: string): number | null {
    for (const [prefix, limit] of Object.entries(BATCH_LIMITS)) {
        if (model.startsWith(prefix)) return limit;
    }
    return 32;
}

async function resolveProviderKwargs(
    prefix: string,
    modelName: string,
    extra: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const kwargs: Record<string, unknown> = { model: modelName };
    if (prefix === "gemini/" || prefix === "google/") {
        const key = process.env["GEMINI_API_KEY"];
        if (key) kwargs["apiKey"] = key;
    }
    if (prefix === "ollama/") {
        const baseUrl = process.env["OLLAMA_BASE_URL"] ?? process.env["OLLAMA_API_BASE"];
        if (baseUrl) kwargs["baseUrl"] = baseUrl;
    }
    return { ...kwargs, ...extra };
}

async function buildFallbackEmbeddings(
    model: string,
    kwargs?: Record<string, unknown>,
): Promise<EmbeddingsLike> {
    if (!model.includes("/")) {
        try {
            // Dynamic import — @langchain/openai is an optional peer dependency.
            // Use a variable so TypeScript doesn't resolve the module at compile time.
            const pkg = "@langchain/openai";
            const mod = (await import(pkg)) as any;
            const { OpenAIEmbeddings } = mod;
            const apiKey = process.env["OPENAI_API_KEY"] ?? "";
            const instance = new OpenAIEmbeddings({
                model,
                ...(apiKey ? { apiKey } : {}),
                ...kwargs,
            });
            console.error("[Embeddings] Using OpenAIEmbeddings for model %s", model);
            return instance;
        } catch {
            /* fall through */
        }
    }
    console.error("[Embeddings] Using simple fallback for model %s", model);
    const instance = new SimpleEmbedder(model, kwargs ?? {});
    return instance;
}

export interface EmbeddingsLike {
    embedDocuments(texts: string[]): Promise<number[][]>;
    embedQuery(text: string): Promise<number[]>;
}

class SimpleEmbedder implements EmbeddingsLike {
    private model: string;

    constructor(model: string, _config: Record<string, unknown>) {
        this.model = model;
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map((t) => this.embedQuery(t)));
    }

    async embedQuery(text: string): Promise<number[]> {
        const dim = getEmbeddingDimension(this.model);
        const hash = Array.from({ length: dim }, (_, i) => {
            let v = 0;
            for (let j = 0; j < text.length; j++) {
                v += text.charCodeAt(j) * (i + 1);
            }
            return (Math.sin(v * 0.01) + 1) / 2;
        });
        return hash;
    }
}

export class BatchLimitingEmbeddings implements EmbeddingsLike {
    readonly inner: EmbeddingsLike;
    readonly batchSize: number;

    constructor(inner: EmbeddingsLike, batchSize: number) {
        if (batchSize < 1) throw new Error(`batchSize must be >= 1, got ${batchSize}`);
        this.inner = inner;
        this.batchSize = batchSize;
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        if (texts.length <= this.batchSize) return this.inner.embedDocuments(texts);
        const out: number[][] = [];
        for (let i = 0; i < texts.length; i += this.batchSize) {
            const chunk = texts.slice(i, i + this.batchSize);
            out.push(...(await this.inner.embedDocuments(chunk)));
        }
        return out;
    }

    async embedQuery(text: string): Promise<number[]> {
        return this.inner.embedQuery(text);
    }
}

export async function buildEmbeddings(
    model: string,
    kwargs?: Record<string, unknown>,
): Promise<EmbeddingsLike> {
    for (const [prefix, pkgName, className, stripPrefix] of PROVIDER_MAP) {
        if (!model.startsWith(prefix)) continue;
        try {
            const mod = await import(pkgName);
            const Cls = mod[className];
            if (!Cls) continue;
            const modelName = stripPrefix ? model.slice(stripPrefix.length) : model;
            const providerKwargs = await resolveProviderKwargs(prefix, modelName, kwargs ?? {});
            const instance = new Cls(providerKwargs);
            console.error("[Embeddings] Using %s.%s for model %s", pkgName, className, model);
            return maybeWrapWithBatchLimit(instance, model);
        } catch (err) {
            console.error("[Embeddings] %s not available for %s: %s", pkgName, model, err);
        }
    }
    return maybeWrapWithBatchLimit(await buildFallbackEmbeddings(model, kwargs), model);
}

function maybeWrapWithBatchLimit(embeddings: EmbeddingsLike, model: string): EmbeddingsLike {
    const batchSize = getEmbeddingBatchSize(model);
    if (batchSize === null) return embeddings;
    console.error(
        "[Embeddings] Wrapping '%s' with BatchLimitingEmbeddings(batchSize=%d)",
        model,
        batchSize,
    );
    return new BatchLimitingEmbeddings(embeddings, batchSize);
}
