import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const ARRAY_SECTION_ENV: Record<string, string> = {
    content_sources: "CONTENT_SOURCES",
};

function extractYamlText(rawText: string, configPath: string): string {
    if (!configPath.endsWith(".md")) {
        return rawText;
    }

    // Markdown config: extract YAML frontmatter between leading --- delimiters.
    const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text.startsWith("---\n")) {
        return "";
    }
    const openingEnd = text.indexOf("\n") + 1;
    const rest = text.slice(openingEnd);
    const delimIdx = rest.indexOf("\n---");
    if (delimIdx === -1) {
        return "";
    }
    return rest.slice(0, delimIdx);
}

const YAML_TO_ENV: Record<string, Record<string, string>> = {
    agents: { config_path: "AGENTS_CONFIG_PATH" },
    llm: {
        model: "LITELLM_MODEL",
        ollama_api_base: "OLLAMA_API_BASE",
        groq_api_key: "GROQ_API_KEY",
        gemini_api_key: "GEMINI_API_KEY",
        anthropic_api_key: "ANTHROPIC_API_KEY",
        openai_api_key: "OPENAI_API_KEY",
    },
    auth: {
        dev_bypass: "DEV_AUTH_BYPASS",
        identity_resolver_class: "IDENTITY_RESOLVER_CLASS",
        auth_config_provider_class: "AUTH_CONFIG_PROVIDER_CLASS",
        auth_exchange_client_class: "AUTH_EXCHANGE_CLIENT_CLASS",
        domain: "AUTH_DOMAIN",
        oauth_client_id_env: "AUTH_OAUTH_CLIENT_ID_ENV",
        oauth_scope: "AUTH_OAUTH_SCOPE",
    },
    startup: { hook: "STARTUP_HOOK" },
    rag: {
        vector_backend: "VECTOR_BACKEND",
        qdrant_url: "QDRANT_URL",
        embedding_model: "EMBEDDING_MODEL",
        openai_api_key: "OPENAI_API_KEY",
        gemini_api_key: "GEMINI_API_KEY",
    },
    cli_rag: {
        vector_backend: "VECTOR_BACKEND",
        qdrant_url: "QDRANT_URL",
        embedding_model: "EMBEDDING_MODEL",
        openai_api_key: "OPENAI_API_KEY",
        gemini_api_key: "GEMINI_API_KEY",
    },
    upload: {
        vision_model: "VISION_MODEL",
        namespace: "UPLOAD_NAMESPACE",
        max_size_mb: "UPLOAD_MAX_SIZE_MB",
        chunk_size: "CHUNK_SIZE",
        chunk_overlap: "CHUNK_OVERLAP",
    },
    storage: {
        class: "CHAT_STORAGE_CLASS",
        dsn: "CHAT_DB_DSN",
        extra_migrations_package: "CHAT_EXTRA_MIGRATIONS_PACKAGE",
    },
    mcp_auth: {
        token_store_class: "MCP_TOKEN_STORE_CLASS",
        token_store_dsn: "MCP_TOKEN_STORE_DSN",
        client_registration_store_class: "MCP_CLIENT_REGISTRATION_STORE_CLASS",
        client_registration_store_dsn: "MCP_CLIENT_REGISTRATION_STORE_DSN",
    },
    checkpointer: {
        type: "CHECKPOINTER_TYPE",
        dsn: "CHECKPOINTER_DSN",
    },
    tracing: {
        langsmith_tracing: "LANGSMITH_TRACING",
        langsmith_api_key: "LANGSMITH_API_KEY",
        langsmith_project: "LANGSMITH_PROJECT",
    },
};

export function applyYamlToEnv(
    configPath: string,
    options?: { skipSections?: Set<string> },
): number {
    let rawText: string;
    try {
        rawText = readFileSync(configPath, "utf-8");
    } catch {
        return 0;
    }

    const yamlText = extractYamlText(rawText, configPath);
    if (!yamlText.trim()) return 0;

    const data = parseYaml(yamlText) as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return 0;

    const skip = options?.skipSections ?? new Set<string>();
    let applied = 0;

    for (const [section, body] of Object.entries(data)) {
        if (skip.has(section)) continue;

        if (Array.isArray(body) && section in ARRAY_SECTION_ENV) {
            const envVar = ARRAY_SECTION_ENV[section];
            if (envVar && !(envVar in process.env)) {
                process.env[envVar] = JSON.stringify(body);
                applied++;
            }
            continue;
        }

        if (typeof body !== "object" || body === null) continue;

        const sectionMap = YAML_TO_ENV[section];
        if (!sectionMap) continue;

        for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
            const envVar = sectionMap[key];
            if (!envVar) continue;
            if (envVar in process.env) continue;

            process.env[envVar] = String(value);
            applied++;
        }
    }

    return applied;
}
