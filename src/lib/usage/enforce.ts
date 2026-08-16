import type { PrismaClient } from "@prisma/client";
import { getUsageLimit, normalizePlan, type Plan } from "./limits";

const UTC_DAY_MS = 86_400_000;

function utcDay(date = new Date()) {
  return new Date(Math.floor(date.getTime() / UTC_DAY_MS) * UTC_DAY_MS);
}

export interface UsageDecision {
  allowed: boolean;
  plan: Plan;
  requests: number;
  tokens: number;
  requestLimit: number;
  tokenLimit: number;
}

export async function enforceDailyUsage(
  prisma: PrismaClient,
  userId: string,
  estimatedTokens: number,
): Promise<UsageDecision> {
  const [subscription, usage] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.usageLedger.findUnique({
      where: { userId_usageDate: { userId, usageDate: utcDay() } },
    }),
  ]);

  const plan = normalizePlan(subscription?.status === "active" ? subscription.plan : "FREE");
  const limit = getUsageLimit(plan);
  const requests = usage?.requests ?? 0;
  const tokens = Number(usage?.inputTokens ?? 0n) + Number(usage?.outputTokens ?? 0n);
  const allowed = requests < limit.requestsPerMinute && tokens + Math.max(estimatedTokens, 0) <= limit.dailyTokens;

  return {
    allowed,
    plan,
    requests,
    tokens,
    requestLimit: limit.requestsPerMinute,
    tokenLimit: limit.dailyTokens,
  };
}
