import { z } from "zod";

export const OrchidContentSourceConfigSchema = z
    .object({
        path: z.string(),
        source: z.string().default("local"),
        fileExtensions: z
            .array(z.string())
            .default([".pdf", ".txt", ".md", ".docx", ".xlsx", ".csv"]),
        metadata: z.record(z.string(), z.string()).default({}),
    })
    .passthrough();

export type OrchidContentSourceConfig = z.infer<typeof OrchidContentSourceConfigSchema>;
