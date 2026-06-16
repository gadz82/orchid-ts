import { z } from "zod";
import { OrchidRAGConfigSchema } from "./rag.js";

export const OrchidMCPAuthConfigSchema = z.object({
    mode: z.enum(["none", "passthrough", "oauth"]).default("none"),
});

export type OrchidMCPAuthConfig = z.infer<typeof OrchidMCPAuthConfigSchema>;

export const OrchidToolConfigSchema = z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).default({}),
    injectToRag: z.boolean().default(false),
    ragTtl: z.number().int().nullable().default(null),
    requiresApproval: z.boolean().default(false),
    parallelSafe: z.boolean().nullable().default(null),
    rag: OrchidRAGConfigSchema.nullable().default(null),
});

export type OrchidToolConfig = z.infer<typeof OrchidToolConfigSchema>;

function normalizeWildcard(val: unknown): unknown {
    if (val === "*" || (Array.isArray(val) && val.length === 1 && val[0] === "*")) {
        return [];
    }
    return val;
}

export const OrchidMCPServerConfigSchema = z
    .object({
        name: z.string(),
        type: z.enum(["local", "remote"]).default("local"),
        transport: z.enum(["streamable_http", "sse"]).default("streamable_http"),
        url: z.string(),
        auth: OrchidMCPAuthConfigSchema.default({}),
        tools: z.preprocess(normalizeWildcard, z.array(OrchidToolConfigSchema).default([])),
        prompts: z.preprocess(normalizeWildcard, z.array(z.string()).default([])),
        resources: z.preprocess(normalizeWildcard, z.array(z.string()).default([])),
        toolCallStrategy: z.string().default("all"),
        discoverAllTools: z.boolean().default(false),
        discoverAllPrompts: z.boolean().default(false),
        discoverAllResources: z.boolean().default(false),
    })
    .strict()
    .transform((val) => {
        return val;
    });

export type OrchidMCPServerConfig = z.infer<typeof OrchidMCPServerConfigSchema>;
