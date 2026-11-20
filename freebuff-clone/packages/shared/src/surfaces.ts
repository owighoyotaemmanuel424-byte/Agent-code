import { z } from "zod";

/**
 * Product surfaces. Every session, ad slot and quota record is scoped to one,
 * and all four share the same runtime and context model.
 */
export const surfaceSchema = z.enum(["cli", "desktop", "web", "cloud"]);
export type Surface = z.infer<typeof surfaceSchema>;
