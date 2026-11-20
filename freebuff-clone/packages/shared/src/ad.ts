import { z } from "zod";
import { adIdSchema, sessionIdSchema } from "./ids";
import { surfaceSchema } from "./surfaces";
import { timestampSchema } from "./time";

/** Slots are declared per surface so inventory is never rendered off-contract. */
export const adSlotSchema = z.enum([
  "cli.session",
  "cli.startup",
  "desktop.sidebar",
  "web.builder",
  "cloud.dashboard",
]);
export type AdSlot = z.infer<typeof adSlotSchema>;

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "Ad destinations must be HTTPS",
  });

/**
 * Sponsored text ads are plain text, labelled literally "Sponsored", and never
 * interrupt or block a workflow step.
 */
export const adSchema = z.object({
  id: adIdSchema,
  advertiser: z.string().min(1).max(80),
  headline: z.string().min(1).max(90),
  body: z.string().min(1).max(200),
  destinationUrl: httpsUrlSchema,
  label: z.literal("Sponsored"),
  topics: z.array(z.string().min(1).max(40)).max(20),
  slots: z.array(adSlotSchema).min(1),
  status: z.enum(["draft", "active", "paused"]),
  weight: z.number().int().min(1).max(100),
});
export type Ad = z.infer<typeof adSchema>;

/**
 * Targeting input. Topics are derived locally from an embedding of the prompt;
 * the raw prompt never leaves the platform for ad selection.
 */
export const adTargetingSchema = z.object({
  slot: adSlotSchema,
  topics: z.array(z.string().min(1).max(40)).max(20),
  plan: z.literal("free"),
});
export type AdTargeting = z.infer<typeof adTargetingSchema>;

export const adDecisionSchema = z.object({
  slot: adSlotSchema,
  ad: adSchema,
  rationale: z.enum(["contextual", "fallback"]),
});
export type AdDecision = z.infer<typeof adDecisionSchema>;

/** Impression records carry no prompt text, code or identifiers beyond the ad. */
export const adImpressionSchema = z.object({
  adId: adIdSchema,
  slot: adSlotSchema,
  surface: surfaceSchema,
  sessionId: sessionIdSchema,
  shownAt: timestampSchema,
});
export type AdImpression = z.infer<typeof adImpressionSchema>;
