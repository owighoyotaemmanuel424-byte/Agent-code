import { z } from "zod";

/** ISO-8601 timestamp string, always UTC. Storage and transport use strings. */
export const timestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected an ISO-8601 timestamp",
  });

export type Timestamp = z.infer<typeof timestampSchema>;

export const nowIso = (): string => new Date().toISOString();
