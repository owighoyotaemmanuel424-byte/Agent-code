import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const timestamps = {
  createdAt: v.number(),
  updatedAt: v.number(),
};

export default defineSchema({
  users: defineTable({
    legacyId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    role: v.union(v.literal("USER"), v.literal("ADMIN")),
    emailVerified: v.optional(v.number()),
    ...timestamps,
  }).index("by_legacy_id", ["legacyId"]).index("by_email", ["email"]),

  sessions: defineTable({
    tokenHash: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
    ...timestamps,
  }).index("by_token", ["tokenHash"]).index("by_user_expiry", ["userId", "expiresAt"]),

  workspaces: defineTable({ name: v.string(), ...timestamps }).index("by_updated", ["updatedAt"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"), userId: v.id("users"),
    role: v.union(v.literal("OWNER"), v.literal("ADMIN"), v.literal("MEMBER")), ...timestamps,
  }).index("by_workspace_user", ["workspaceId", "userId"]).index("by_user_workspace", ["userId", "workspaceId"]),

  conversations: defineTable({
    userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), title: v.string(), model: v.string(),
    pinned: v.boolean(), status: v.union(v.literal("ACTIVE"), v.literal("ARCHIVED")), ...timestamps,
  }).index("by_user_updated", ["userId", "updatedAt"]).index("by_user_pinned_updated", ["userId", "pinned", "updatedAt"]).index("by_workspace_updated", ["workspaceId", "updatedAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"), role: v.union(v.literal("USER"), v.literal("ASSISTANT"), v.literal("SYSTEM")),
    content: v.string(), model: v.optional(v.string()), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()), ...timestamps,
  }).index("by_conversation_created", ["conversationId", "createdAt"]),

  knowledgeDocuments: defineTable({
    workspaceId: v.id("workspaces"), ownerId: v.id("users"), name: v.string(), objectKey: v.string(), mimeType: v.string(),
    size: v.number(), status: v.union(v.literal("PENDING"), v.literal("INDEXING"), v.literal("READY"), v.literal("FAILED")),
    error: v.optional(v.string()), ...timestamps,
  }).index("by_object_key", ["objectKey"]).index("by_workspace_status_updated", ["workspaceId", "status", "updatedAt"]).index("by_owner_created", ["ownerId", "createdAt"]),

  subscriptions: defineTable({
    userId: v.id("users"), plan: v.union(v.literal("FREE"), v.literal("PRO"), v.literal("TEAM"), v.literal("ENTERPRISE")), status: v.string(),
    provider: v.optional(v.string()), providerId: v.optional(v.string()), currentPeriodEnd: v.optional(v.number()), ...timestamps,
  }).index("by_user", ["userId"]).index("by_plan_status", ["plan", "status"]),

  usageLedger: defineTable({
    userId: v.id("users"), usageDate: v.number(), requests: v.number(), inputTokens: v.number(), outputTokens: v.number(), ...timestamps,
  }).index("by_user_date", ["userId", "usageDate"]),
});
