import type { Plan } from "@freebuff/shared";
import type { ResolvedQuota } from "./config";

/**
 * Everything a plan unlocks in one place. Quota, advertising and model access
 * all read entitlements, so a surface cannot invent a different combination
 * (for example "paid but still shown ads").
 */
export interface PlanEntitlements {
  readonly plan: Plan;
  readonly hoursPerDay: number;
  readonly adsEnabled: boolean;
  /** Paid plans may select models whose catalog tier is `paid`. */
  readonly premiumModels: boolean;
}

export const resolveEntitlements = (
  quota: ResolvedQuota,
  plan: Plan,
): PlanEntitlements => ({
  plan,
  hoursPerDay: plan === "paid" ? quota.paidHoursPerDay : quota.freeHoursPerDay,
  adsEnabled: plan === "free",
  premiumModels: plan === "paid",
});
