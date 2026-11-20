import { z } from "zod";
import { userIdSchema } from "./ids";
import { planSchema } from "./plans";
import { timestampSchema } from "./time";

// An allowance can exceed 24 because sessions run concurrently; the ceiling only
// guards against a mistyped configuration (a week of hours).
const hoursPerDaySchema = z.number().positive().max(168);

/**
 * Per-country quota policy. Values live in configuration (packages/quota), so a
 * policy change never requires a code change or redeploy of the runtime.
 */
export const countryQuotaConfigSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 code"),
    timeZone: z.string().min(1),
    freeHoursPerDay: hoursPerDaySchema,
    paidHoursPerDay: hoursPerDaySchema,
    updatedAt: timestampSchema,
  })
  .superRefine((config, ctx) => {
    if (config.paidHoursPerDay < config.freeHoursPerDay) {
      ctx.addIssue({
        code: "custom",
        path: ["paidHoursPerDay"],
        message: "Paid hours must be at least the free allowance",
      });
    }
  });

export type CountryQuotaConfig = z.infer<typeof countryQuotaConfigSchema>;

export const quotaConfigSchema = z
  .object({
    version: z.literal(1),
    default: z.object({
      timeZone: z.string().min(1),
      freeHoursPerDay: hoursPerDaySchema,
      paidHoursPerDay: hoursPerDaySchema,
    }),
    countries: z.array(countryQuotaConfigSchema),
  })
  .superRefine((config, ctx) => {
    if (config.default.paidHoursPerDay < config.default.freeHoursPerDay) {
      ctx.addIssue({
        code: "custom",
        path: ["default", "paidHoursPerDay"],
        message: "Paid hours must be at least the free allowance",
      });
    }
  });
export type QuotaConfig = z.infer<typeof quotaConfigSchema>;

/**
 * Server-side quota state for one user. `consumedSecondsToday` accumulates
 * across active hours only; an active hour never rolls over to the next day.
 */
export const quotaSnapshotSchema = z.object({
  userId: userIdSchema,
  plan: planSchema,
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  timeZone: z.string().min(1),
  hoursPerDay: hoursPerDaySchema,
  consumedSecondsToday: z.number().int().nonnegative(),
  activeHourStartedAt: timestampSchema.optional(),
  resetsAt: timestampSchema,
  phoneVerified: z.boolean(),
  adsEnabled: z.boolean(),
});
export type QuotaSnapshot = z.infer<typeof quotaSnapshotSchema>;

export const quotaDenialReasonSchema = z.enum([
  "quota_exhausted",
  "phone_verification_required",
  "account_suspended",
]);
export type QuotaDenialReason = z.infer<typeof quotaDenialReasonSchema>;

/** Decision returned by the server for every model invocation. */
export const quotaDecisionSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true), snapshot: quotaSnapshotSchema }),
  z.object({
    allowed: z.literal(false),
    reason: quotaDenialReasonSchema,
    snapshot: quotaSnapshotSchema,
  }),
]);
export type QuotaDecision = z.infer<typeof quotaDecisionSchema>;
