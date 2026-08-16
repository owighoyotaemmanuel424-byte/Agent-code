import { mutation } from "./_generated/server";
import { v } from "convex/values";

function assertServiceKey(key: string) {
  if (!process.env.CONVEX_SERVICE_KEY || key !== process.env.CONVEX_SERVICE_KEY) throw new Error("UNAUTHORIZED_SERVICE");
}

export const recordUsage = mutation({
  args: {
    serviceKey: v.string(),
    legacyUserId: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const user = await ctx.db.query("users").withIndex("by_legacy_id", q => q.eq("legacyId", args.legacyUserId)).unique();
    if (!user) throw new Error("USER_NOT_FOUND");

    const day = new Date();
    const usageDate = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const existing = await ctx.db.query("usageLedger").withIndex("by_user_date", q => q.eq("userId", user._id).eq("usageDate", usageDate)).unique();
    const inputTokens = Math.max(0, Math.floor(args.inputTokens));
    const outputTokens = Math.max(0, Math.floor(args.outputTokens));
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        requests: existing.requests + 1,
        inputTokens: existing.inputTokens + inputTokens,
        outputTokens: existing.outputTokens + outputTokens,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("usageLedger", {
      userId: user._id,
      usageDate,
      requests: 1,
      inputTokens,
      outputTokens,
      createdAt: now,
      updatedAt: now,
    });
  },
});
