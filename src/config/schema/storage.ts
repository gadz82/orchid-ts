import { z } from "zod";

export const OrchidConfigStorageConfigSchema = z.object({
    enabled: z.boolean().default(false),
    class: z.string().default(""),
    dsn: z.string().default(""),
});

export type OrchidConfigStorageConfig = z.infer<typeof OrchidConfigStorageConfigSchema>;
