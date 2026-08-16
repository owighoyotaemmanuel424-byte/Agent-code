import type { PrismaClient } from "@prisma/client";

const DAY_MS = 86_400_000;

function utcDay(date = new Date()) {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

export async function recordUsage(
  prisma: PrismaClient,
  input: {
    userId: string;
    inputTokens?: number;
    outputTokens?: number;
  },
) {
  const usageDate = utcDay();
  const inputTokens = Math.max(0, Math.floor(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens ?? 0));

  return prisma.usageLedger.upsert({
    where: { userId_usageDate: { userId: input.userId, usageDate } },
    create: {
      userId: input.userId,
      usageDate,
      requests: 1,
      inputTokens: BigInt(inputTokens),
      outputTokens: BigInt(outputTokens),
    },
    update: {
      requests: { increment: 1 },
      inputTokens: { increment: BigInt(inputTokens) },
      outputTokens: { increment: BigInt(outputTokens) },
    },
  });
}
