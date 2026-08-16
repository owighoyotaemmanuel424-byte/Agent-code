import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function assertServiceKey(key: string) {
  if (!process.env.CONVEX_SERVICE_KEY || key !== process.env.CONVEX_SERVICE_KEY) {
    throw new Error("UNAUTHORIZED_SERVICE");
  }
}

export const upsertUser = mutation({
  args: {
    serviceKey: v.string(),
    legacyId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    role: v.union(v.literal("USER"), v.literal("ADMIN")),
    emailVerified: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const existing = await ctx.db.query("users").withIndex("by_legacy_id", q => q.eq("legacyId", args.legacyId)).unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { email: args.email, name: args.name, passwordHash: args.passwordHash, role: args.role, emailVerified: args.emailVerified, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("users", { legacyId: args.legacyId, email: args.email, name: args.name, passwordHash: args.passwordHash, role: args.role, emailVerified: args.emailVerified, createdAt: now, updatedAt: now });
  },
});

export const createSession = mutation({
  args: { serviceKey: v.string(), legacyUserId: v.string(), tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const user = await ctx.db.query("users").withIndex("by_legacy_id", q => q.eq("legacyId", args.legacyUserId)).unique();
    if (!user) throw new Error("USER_NOT_FOUND");
    const now = Date.now();
    return ctx.db.insert("sessions", { tokenHash: args.tokenHash, userId: user._id, expiresAt: args.expiresAt, createdAt: now, updatedAt: now });
  },
});

export const getSessionUser = query({
  args: { serviceKey: v.string(), tokenHash: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const session = await ctx.db.query("sessions").withIndex("by_token", q => q.eq("tokenHash", args.tokenHash)).unique();
    if (!session || session.expiresAt <= Date.now()) return null;
    return await ctx.db.get(session.userId);
  },
});
