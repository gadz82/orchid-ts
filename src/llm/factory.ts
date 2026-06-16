import { getLlmKwargs } from "./keys.js";

interface BuildChatModelOpts {
    temperature?: number;
    fallbackModel?: string | null;
    retryAttempts?: number;
}

interface ChatModelLike {
    invoke(
        messages: Array<{ role: string; content: string }>,
        opts?: Record<string, unknown>,
    ): Promise<{ content: string }>;
}

interface ChatModelConstructor {
    new (config: Record<string, unknown>): ChatModelLike;
}

interface ProviderEntry {
    prefix: string;
    pkgName: string;
    className: string;
}

const PROVIDERS: ProviderEntry[] = [
    { prefix: "openai/", pkgName: "@langchain/openai", className: "ChatOpenAI" },
    { prefix: "gemini/", pkgName: "@langchain/google-genai", className: "ChatGoogleGenerativeAI" },
    { prefix: "google/", pkgName: "@langchain/google-genai", className: "ChatGoogleGenerativeAI" },
    { prefix: "anthropic/", pkgName: "@langchain/anthropic", className: "ChatAnthropic" },
    { prefix: "claude-", pkgName: "@langchain/anthropic", className: "ChatAnthropic" },
    { prefix: "ollama/", pkgName: "@langchain/ollama", className: "ChatOllama" },
    { prefix: "ollama_chat/", pkgName: "@langchain/ollama", className: "ChatOllama" },
    { prefix: "groq/", pkgName: "@langchain/groq", className: "ChatGroq" },
    { prefix: "mistral/", pkgName: "@langchain/mistralai", className: "ChatMistralAI" },
    { prefix: "bedrock/", pkgName: "@langchain/aws", className: "ChatBedrock" },
    { prefix: "deepseek/", pkgName: "@langchain/openai", className: "ChatOpenAI" },
];

async function buildFromProvider(
    entry: ProviderEntry,
    modelName: string,
    fullModel: string,
    temperature: number,
): Promise<ChatModelLike> {
    const mod = await import(entry.pkgName);
    const Cls = (mod as Record<string, ChatModelConstructor>)[entry.className];
    if (!Cls) throw new Error(`${entry.className} not found in ${entry.pkgName}`);

    const kwargs = getLlmKwargs(fullModel);
    const config: Record<string, unknown> = {
        model: modelName,
        temperature,
    };

    if (kwargs["api_key"]) {
        config["apiKey"] = kwargs["api_key"];
    }
    if (kwargs["api_base"]) {
        config["baseUrl"] = kwargs["api_base"];
    }

    return new Cls(config);
}

function stripPrefix(model: string, prefix: string): string {
    return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

async function buildFallback(model: string, temperature: number): Promise<ChatModelLike> {
    if (!model.includes("/")) {
        try {
            // @ts-expect-error - optional peer dep
            const mod = (await import("@langchain/openai")) as Record<string, ChatModelConstructor>;
            const { ChatOpenAI } = mod;
            if (!ChatOpenAI) throw new Error("ChatOpenAI not available");
            const apiKey = process.env["OPENAI_API_KEY"] ?? "";
            const instance = new ChatOpenAI({
                model,
                temperature,
                ...(apiKey ? { apiKey } : {}),
            });
            console.error("[LLM] Using ChatOpenAI fallback for model %s", model);
            return instance;
        } catch (err) {
            console.error("[LLM] ChatOpenAI fallback failed for %s: %s", model, err);
        }
    }

    console.error("[LLM] No provider available for %s — using mock chat model", model);
    return new MockModel(model);
}

export async function buildChatModel(model: string, opts?: BuildChatModelOpts): Promise<unknown> {
    const temperature = opts?.temperature ?? 0.2;
    const fallbackModel = opts?.fallbackModel ?? null;

    for (const entry of PROVIDERS) {
        if (!model.startsWith(entry.prefix)) continue;

        try {
            const modelName = stripPrefix(model, entry.prefix);
            return await buildFromProvider(entry, modelName, model, temperature);
        } catch (err) {
            console.error("[LLM] %s failed for model %s: %s", entry.pkgName, model, err);
        }
    }

    if (fallbackModel) {
        console.error("[LLM] Falling back to model %s", fallbackModel);
        try {
            return await buildChatModel(fallbackModel, { ...opts, fallbackModel: null });
        } catch (err) {
            console.error("[LLM] Fallback model %s also failed: %s", fallbackModel, err);
        }
    }

    return buildFallback(model, temperature);
}

class MockModel implements ChatModelLike {
    private model: string;

    constructor(model: string) {
        this.model = model;
    }

    async invoke(
        _messages: Array<{ role: string; content: string }>,
        _opts?: Record<string, unknown>,
    ): Promise<{ content: string }> {
        return {
            content: `[Mock response from ${this.model}]`,
        };
    }
}
