import { z } from "zod";

const PROMPT_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export const OrchidMCPGatewayToolOverrideSchema = z.object({
    title: z.string().nullable().default(null),
    description: z.string().nullable().default(null),
});

export type OrchidMCPGatewayToolOverride = z.infer<typeof OrchidMCPGatewayToolOverrideSchema>;

export const OrchidMCPGatewayPromptArgumentSchema = z.object({
    name: z.string().refine((v): v is string => PROMPT_NAME_RE.test(v), {
        message: `Prompt argument name must match /^[a-zA-Z_][a-zA-Z0-9_-]*$/`,
    }),
    description: z.string().nullable().default(null),
    required: z.boolean().default(false),
});

export type OrchidMCPGatewayPromptArgument = z.infer<typeof OrchidMCPGatewayPromptArgumentSchema>;

export const OrchidMCPGatewayPromptSchema = z
    .object({
        name: z.string().refine((v): v is string => PROMPT_NAME_RE.test(v), {
            message: `Prompt name must match /^[a-zA-Z_][a-zA-Z0-9_-]*$/`,
        }),
        title: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
        arguments: z.array(OrchidMCPGatewayPromptArgumentSchema).default([]),
        template: z.string(),
    })
    .superRefine((prompt, ctx) => {
        const seen = new Set<string>();
        for (const arg of prompt.arguments) {
            if (seen.has(arg.name)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Prompt '${prompt.name}' declares duplicate argument '${arg.name}'`,
                    path: ["arguments"],
                });
            }
            seen.add(arg.name);
        }
    });

export type OrchidMCPGatewayPrompt = z.infer<typeof OrchidMCPGatewayPromptSchema>;

export const OrchidMCPGatewayConfigSchema = z
    .object({
        tools: z.record(z.string(), OrchidMCPGatewayToolOverrideSchema).default({}),
        prompts: z.array(OrchidMCPGatewayPromptSchema).default([]),
    })
    .superRefine((config, ctx) => {
        const seen = new Set<string>();
        let idx = 0;
        for (const prompt of config.prompts) {
            if (seen.has(prompt.name)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Duplicate prompt name '${prompt.name}' in mcp_gateway.prompts`,
                    path: ["prompts", idx],
                });
            }
            seen.add(prompt.name);
            idx++;
        }
    });

export type OrchidMCPGatewayConfig = z.infer<typeof OrchidMCPGatewayConfigSchema>;
