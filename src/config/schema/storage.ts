import { z } from "zod";

export const OrchidConfigStorageConfigSchema = z.object({
    enabled: z.boolean().default(false),
    class: z.string().default(""),
    dsn: z.string().default(""),
});

export type OrchidConfigStorageConfig = z.infer<typeof OrchidConfigStorageConfigSchema>;

export const OrchidChatStorageConfigSchema = z.object({
    class: z.string().default("sqlite"),
    dsn: z.string().default(""),
});

export type OrchidChatStorageConfig = z.infer<typeof OrchidChatStorageConfigSchema>;
