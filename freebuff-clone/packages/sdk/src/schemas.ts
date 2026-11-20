import {
  adDecisionSchema,
  planSchema,
  quotaDecisionSchema,
  quotaSnapshotSchema,
  userIdSchema,
} from "@freebuff/shared";
import { z } from "zod";

export const sdkUserSchema = z.object({
  id: userIdSchema,
  email: z.string().min(1),
  plan: planSchema,
  phoneVerified: z.boolean(),
  createdAt: z.string().min(1),
});
export type SdkUser = z.infer<typeof sdkUserSchema>;

export const sdkSessionSchema = z.object({
  sessionToken: z.string().min(1),
  user: sdkUserSchema.pick({ id: true, email: true }),
});
export type SdkSession = z.infer<typeof sdkSessionSchema>;

export const sdkQuotaSchema = z.object({
  snapshot: quotaSnapshotSchema,
  decision: quotaDecisionSchema,
});
export type SdkQuota = z.infer<typeof sdkQuotaSchema>;

export const sdkAppSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(["building", "deployed", "failed"]),
  spec: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
  deployedAt: z.string().min(1).optional(),
  url: z.string().url(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
});
export type SdkApp = z.infer<typeof sdkAppSchema>;

export const sdkBuildSchema = z.object({
  app: sdkAppSchema,
  url: z.string().url(),
  timeline: z.array(
    z.object({
      step: z.string(),
      status: z.string(),
      detail: z.string().optional(),
    }),
  ),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
});
export type SdkBuild = z.infer<typeof sdkBuildSchema>;

export const sdkRowSchema = z.record(z.string(), z.unknown());
export const sdkRowsSchema = z.object({ rows: z.array(sdkRowSchema) });

export const sdkFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number(),
  createdAt: z.string().optional(),
});
export const sdkFilesSchema = z.object({ files: z.array(sdkFileSchema) });

export const sdkAdsSchema = z.object({
  decision: adDecisionSchema.nullable(),
  label: z.literal("Sponsored"),
  plan: planSchema.optional(),
});
export type SdkAds = z.infer<typeof sdkAdsSchema>;

export const sdkCheckoutSchema = z.object({
  url: z.string(),
  reference: z.string(),
  expiresAt: z.string(),
});
export type SdkCheckout = z.infer<typeof sdkCheckoutSchema>;

export const sdkBillingStatusSchema = z.object({
  plan: planSchema,
  subscription: z
    .object({
      plan: planSchema,
      status: z.enum(["active", "canceled"]),
      provider: z.string(),
      reference: z.string(),
      currentPeriodEnd: z.string().optional(),
      updatedAt: z.string(),
    })
    .optional(),
});
export type SdkBillingStatus = z.infer<typeof sdkBillingStatusSchema>;

export const sdkPhoneChallengeSchema = z.object({
  phone: z.string(),
  maskedPhone: z.string(),
  expiresAt: z.string(),
  delivery: z.enum(["dev", "sms"]),
  code: z.string().optional(),
});
export type SdkPhoneChallenge = z.infer<typeof sdkPhoneChallengeSchema>;

export const sdkEjectGitHubSchema = z.object({
  url: z.string().url(),
  owner: z.string(),
  repo: z.string(),
  files: z.number(),
});
export type SdkEjectGitHub = z.infer<typeof sdkEjectGitHubSchema>;
