import { z } from "zod";
import { OrchidRAGConfigSchema } from "./rag.js";

export const BuiltinToolParameterSchema = z.object({
    type: z.string().default("string"),
    description: z.string().default(""),
    required: z.boolean().default(true),
    default: z.unknown().nullable().default(null),
    items: z.unknown().optional(),
});

export type BuiltinToolParameter = z.infer<typeof BuiltinToolParameterSchema>;

export const OrchidBuiltinToolConfigSchema = z
    .object({
        class: z.string().nullable().default(null),
        handler: z.string().nullable().default(null),
        description: z.string().default(""),
        parameters: z.record(z.string(), BuiltinToolParameterSchema).default({}),
        injectToRag: z.boolean().default(false),
        ragTtl: z.number().int().nullable().default(null),
        requiresApproval: z.boolean().default(false),
        parallelSafe: z.boolean().nullable().default(null),
        rag: OrchidRAGConfigSchema.nullable().default(null),
    })
    .superRefine((tool, ctx) => {
        if (!tool.class && !tool.handler) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Tool must set either 'class' or 'handler'",
                path: ["class"],
            });
        }
    });

export type OrchidBuiltinToolConfig = z.infer<typeof OrchidBuiltinToolConfigSchema>;

export const OrchidAgentSkillStepConfigSchema = z
    .object({
        tool: z.string().nullable().default(null),
        source: z.string().nullable().default(null),
        arguments: z.record(z.string(), z.unknown()).default({}),
        agent: z.string().nullable().default(null),
        instruction: z.string().default(""),
    })
    .superRefine((step, ctx) => {
        if (step.tool && step.agent) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "A skill step must set either 'tool' or 'agent', not both",
                path: ["tool"],
            });
        }
        if (!step.tool && !step.agent) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "A skill step must set either 'tool' or 'agent'",
                path: ["tool"],
            });
        }
    });

export type OrchidAgentSkillStepConfig = z.infer<typeof OrchidAgentSkillStepConfigSchema>;

export const OrchidAgentSkillConfigSchema = z.object({
    description: z.string().default(""),
    steps: z.array(OrchidAgentSkillStepConfigSchema),
});

export type OrchidAgentSkillConfig = z.infer<typeof OrchidAgentSkillConfigSchema>;

export const OrchidOrchestratorSkillStepConfigSchema = z.object({
    agent: z.string(),
    instruction: z.string().default(""),
});

export type OrchidOrchestratorSkillStepConfig = z.infer<
    typeof OrchidOrchestratorSkillStepConfigSchema
>;

export const OrchidOrchestratorSkillConfigSchema = z.object({
    description: z.string().default(""),
    steps: z.array(OrchidOrchestratorSkillStepConfigSchema),
});

export type OrchidOrchestratorSkillConfig = z.infer<typeof OrchidOrchestratorSkillConfigSchema>;
