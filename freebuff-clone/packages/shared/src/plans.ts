import { z } from "zod";

/** Plan tiers. Quota, ads and model access all key off this value. */
export const planSchema = z.enum(["free", "paid"]);
export type Plan = z.infer<typeof planSchema>;
