import type { Plan, QuotaDecision, QuotaSnapshot, UserId } from "@freebuff/shared";
import type { ResolvedQuota } from "./config";
import { resolveEntitlements } from "./entitlements";
import { HOUR_SECONDS, localDayKey, nextLocalMidnight } from "./time";

/** Persisted quota state for one user. The service owns writes. */
export interface QuotaUsageRecord {
  readonly userId: UserId;
  readonly plan: Plan;
  readonly countryCode: string;
  readonly dayKey: string;
  readonly consumedSeconds: number;
  readonly activeHourStartedAt?: string;
  readonly phoneVerified: boolean;
  readonly suspended: boolean;
}

export interface QuotaEvaluation {
  readonly snapshot: QuotaSnapshot;
  readonly decision: QuotaDecision;
}

export interface EvaluateInput {
  readonly userId: UserId;
  readonly plan: Plan;
  readonly phoneVerified: boolean;
  readonly countryCode: string;
  readonly record: QuotaUsageRecord | undefined;
  readonly quota: ResolvedQuota;
  readonly now: Date;
}

const activeHourIsCurrent = (
  startedAt: string | undefined,
  now: Date,
): boolean => {
  if (startedAt === undefined) {
    return false;
  }
  const startedMs = Date.parse(startedAt);
  if (Number.isNaN(startedMs)) {
    return false;
  }
  const elapsed = now.getTime() - startedMs;
  return elapsed >= 0 && elapsed < HOUR_SECONDS * 1000;
};

/**
 * Computes the snapshot and the allow/deny decision. Pure: no writes, no I/O.
 * A new local day starts from zero — unused hours never carry over.
 */
export const evaluateQuota = (input: EvaluateInput): QuotaEvaluation => {
  const { now, quota } = input;
  const today = localDayKey(now, quota.timeZone);
  const isSameDay = input.record?.dayKey === today;

  const consumedSeconds = isSameDay ? (input.record?.consumedSeconds ?? 0) : 0;
  const activeHour =
    isSameDay && activeHourIsCurrent(input.record?.activeHourStartedAt, now)
      ? input.record?.activeHourStartedAt
      : undefined;

  const entitlements = resolveEntitlements(quota, input.plan);
  const hoursPerDay = entitlements.hoursPerDay;
  const allowanceSeconds = hoursPerDay * HOUR_SECONDS;
  const remainingSeconds = Math.max(0, allowanceSeconds - consumedSeconds);

  const snapshot: QuotaSnapshot = {
    userId: input.userId,
    plan: input.plan,
    countryCode: quota.countryCode,
    timeZone: quota.timeZone,
    hoursPerDay,
    consumedSecondsToday: consumedSeconds,
    ...(activeHour === undefined ? {} : { activeHourStartedAt: activeHour }),
    resetsAt: nextLocalMidnight(now, quota.timeZone).toISOString(),
    phoneVerified: input.phoneVerified,
    adsEnabled: entitlements.adsEnabled,
  };

  if (input.record?.suspended === true) {
    return {
      snapshot,
      decision: { allowed: false, reason: "account_suspended", snapshot },
    };
  }
  if (input.plan === "free" && !input.phoneVerified) {
    return {
      snapshot,
      decision: {
        allowed: false,
        reason: "phone_verification_required",
        snapshot,
      },
    };
  }
  if (!activeHour && remainingSeconds < HOUR_SECONDS) {
    return {
      snapshot,
      decision: { allowed: false, reason: "quota_exhausted", snapshot },
    };
  }
  return { snapshot, decision: { allowed: true, snapshot } };
};
