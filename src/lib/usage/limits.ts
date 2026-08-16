export type Plan = "FREE" | "PRO" | "TEAM" | "ENTERPRISE";

export interface UsageLimit {
  requestsPerMinute: number;
  dailyTokens: number;
}

const LIMITS: Record<Plan, UsageLimit> = {
  FREE: { requestsPerMinute: 10, dailyTokens: 100_000 },
  PRO: { requestsPerMinute: 60, dailyTokens: 1_000_000 },
  TEAM: { requestsPerMinute: 180, dailyTokens: 5_000_000 },
  ENTERPRISE: { requestsPerMinute: 600, dailyTokens: 50_000_000 },
};

export function getUsageLimit(plan: Plan): UsageLimit {
  return LIMITS[plan];
}

export function normalizePlan(value: string | null | undefined): Plan {
  const plan = value?.toUpperCase();
  return plan === "PRO" || plan === "TEAM" || plan === "ENTERPRISE" ? plan : "FREE";
}
