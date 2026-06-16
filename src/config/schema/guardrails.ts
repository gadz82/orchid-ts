import { z } from "zod";

export const OrchidGuardrailRuleConfigSchema = z.object({
    type: z.string(),
    failAction: z.enum(["block", "warn", "redact", "log"]).default("block"),
    config: z.record(z.string(), z.unknown()).default({}),
});

export type OrchidGuardrailRuleConfig = z.infer<typeof OrchidGuardrailRuleConfigSchema>;

export const OrchidGuardrailsConfigSchema = z.object({
    input: z.array(OrchidGuardrailRuleConfigSchema).default([]),
    output: z.array(OrchidGuardrailRuleConfigSchema).default([]),
});

export type OrchidGuardrailsConfig = z.infer<typeof OrchidGuardrailsConfigSchema>;
