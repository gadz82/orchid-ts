import { z } from "zod";

export const ActAsUserIdentitySchema = z.object({
    type: z.literal("act_as"),
    userId: z.string(),
});

export type ActAsUserIdentity = z.infer<typeof ActAsUserIdentitySchema>;

export const AddressedToUserIdentitySchema = z.object({
    type: z.literal("addressed_to"),
    userId: z.string(),
});

export type AddressedToUserIdentity = z.infer<typeof AddressedToUserIdentitySchema>;

export const ServiceAccountIdentitySchema = z.object({
    type: z.literal("service_account"),
    name: z.string(),
});

export type ServiceAccountIdentity = z.infer<typeof ServiceAccountIdentitySchema>;

const EventIdentitySchema = z.discriminatedUnion("type", [
    ActAsUserIdentitySchema,
    AddressedToUserIdentitySchema,
    ServiceAccountIdentitySchema,
]);

export const OrchidIngestionSourceConfigSchema = z
    .object({
        type: z.string().default("local"),
        path: z.string().default(""),
        fileExtensions: z
            .array(z.string())
            .default([".pdf", ".txt", ".md", ".docx", ".xlsx", ".csv"]),
        metadata: z.record(z.string(), z.string()).default({}),
    })
    .passthrough();

export type OrchidIngestionSourceConfig = z.infer<typeof OrchidIngestionSourceConfigSchema>;

export const OrchidEventsIngestionConfigSchema = z.object({
    sources: z.array(OrchidIngestionSourceConfigSchema).default([]),
    vectorBackend: z.string().nullable().default(null),
    namespace: z.string().default(""),
    embeddingModel: z.string().nullable().default(null),
});

export type OrchidEventsIngestionConfig = z.infer<typeof OrchidEventsIngestionConfigSchema>;

export const OrchidProcessorConfigSchema = z.object({
    type: z.string(),
    config: z.record(z.string(), z.unknown()).default({}),
    identity: EventIdentitySchema.optional(),
    ingestion: OrchidEventsIngestionConfigSchema.optional(),
});

export type OrchidProcessorConfig = z.infer<typeof OrchidProcessorConfigSchema>;

export const OrchidValidatorConfigSchema = z.object({
    type: z.string(),
    config: z.record(z.string(), z.unknown()).default({}),
});

export type OrchidValidatorConfig = z.infer<typeof OrchidValidatorConfigSchema>;

export const OrchidTriggerEmitConfigSchema = z.object({
    signal: z.string(),
    payload: z.record(z.string(), z.unknown()).default({}),
});

export type OrchidTriggerEmitConfig = z.infer<typeof OrchidTriggerEmitConfigSchema>;

export const OrchidTriggerMatchConfigSchema = z.object({
    signalSource: z.string().optional(),
    payloadKey: z.string().optional(),
});

export type OrchidTriggerMatchConfig = z.infer<typeof OrchidTriggerMatchConfigSchema>;

export const OrchidTriggerRetryConfigSchema = z.object({
    maxRetries: z.number().int().default(3),
    backoff: z.enum(["fixed", "exponential"]).default("exponential"),
    delaySeconds: z.number().int().default(60),
    maxDelaySeconds: z.number().int().default(3600),
});

export type OrchidTriggerRetryConfig = z.infer<typeof OrchidTriggerRetryConfigSchema>;

export const OrchidTriggerConfigSchema = z.object({
    signal: z.string().optional(),
    predicate: z.string().optional(),
    match: OrchidTriggerMatchConfigSchema.optional(),
    action: z.string(),
    emits: z.array(OrchidTriggerEmitConfigSchema).default([]),
    retry: OrchidTriggerRetryConfigSchema.optional(),
    config: z.record(z.string(), z.unknown()).default({}),
});

export type OrchidTriggerConfig = z.infer<typeof OrchidTriggerConfigSchema>;

export const OrchidQueueConfigSchema = z.object({
    backend: z.string().default("memory"),
    dsn: z.string().nullable().default(null),
    visibilityTimeoutSeconds: z.number().int().default(30),
    maxReceiveCount: z.number().int().default(3),
    leasePollIntervalMs: z.number().int().default(1000),
});

export type OrchidQueueConfig = z.infer<typeof OrchidQueueConfigSchema>;

export const OrchidScheduleConfigSchema = z.object({
    expression: z.string(),
    timezone: z.string().default("UTC"),
    signal: z.string(),
    payload: z.record(z.string(), z.unknown()).default({}),
    enabled: z.boolean().default(true),
});

export type OrchidScheduleConfig = z.infer<typeof OrchidScheduleConfigSchema>;

export const OrchidProducerConfigSchema = z.object({
    class: z.string(),
    extraArgs: z.record(z.string(), z.unknown()).default({}),
});

export type OrchidProducerConfig = z.infer<typeof OrchidProducerConfigSchema>;

export const OrchidEventsConfigSchema = z.object({
    enabled: z.boolean().default(false),
    queue: OrchidQueueConfigSchema.optional(),
    producers: z.array(OrchidProducerConfigSchema).default([]),
    processors: z.array(OrchidProcessorConfigSchema).default([]),
    validators: z.array(OrchidValidatorConfigSchema).default([]),
    triggers: z.array(OrchidTriggerConfigSchema).default([]),
    schedules: z.array(OrchidScheduleConfigSchema).default([]),
    ingestion: OrchidEventsIngestionConfigSchema.optional(),
});

export type OrchidEventsConfig = z.infer<typeof OrchidEventsConfigSchema>;
