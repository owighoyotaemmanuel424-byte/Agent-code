import { z } from "zod";
import { agentIdSchema, runIdSchema, sessionIdSchema } from "./ids";
import { timestampSchema } from "./time";
import { toolCallIdSchema } from "./ids";
import { toolResultSchema } from "./tool";
import { surfaceSchema } from "./surfaces";

export const agentRoleSchema = z.enum(["primary", "subagent"]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentMessageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
]);
export type AgentMessageRole = z.infer<typeof agentMessageRoleSchema>;

export const agentMessageSchema = z.object({
  id: z.string().min(1),
  role: agentMessageRoleSchema,
  content: z.string(),
  toolCalls: z.array(z.object({
    id: toolCallIdSchema,
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  })).optional(),
  toolCallId: toolCallIdSchema.optional(),
  createdAt: timestampSchema,
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

/** Hard ceilings for one agent run. All values are configuration driven. */
export const agentLimitsSchema = z.object({
  maxSteps: z.number().int().min(1).max(500),
  maxTokens: z.number().int().positive(),
  maxWallClockMs: z.number().int().positive(),
  maxParallelSubagents: z.number().int().min(1).max(16),
});
export type AgentLimits = z.infer<typeof agentLimitsSchema>;

export const agentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
});
export type AgentUsage = z.infer<typeof agentUsageSchema>;

/**
 * Streaming event union emitted by the runtime. Surfaces render from these
 * events only, so CLI, Desktop and Web never diverge in behaviour.
 */
export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.started"),
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    agentId: agentIdSchema,
    surface: surfaceSchema,
    startedAt: timestampSchema,
  }),
  z.object({
    type: z.literal("message.delta"),
    runId: runIdSchema,
    messageId: z.string().min(1),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("message.completed"),
    runId: runIdSchema,
    message: agentMessageSchema,
  }),
  z.object({
    type: z.literal("tool.started"),
    runId: runIdSchema,
    callId: toolCallIdSchema,
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("tool.finished"),
    runId: runIdSchema,
    result: toolResultSchema,
  }),
  z.object({
    type: z.literal("subagent.started"),
    runId: runIdSchema,
    parentRunId: runIdSchema,
    agentId: agentIdSchema,
    task: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal("subagent.finished"),
    runId: runIdSchema,
    parentRunId: runIdSchema,
    agentId: agentIdSchema,
    status: z.enum(["completed", "failed", "cancelled"]),
    summary: z.string().max(8000),
  }),
  z.object({
    type: z.literal("usage"),
    runId: runIdSchema,
    usage: agentUsageSchema,
  }),
  z.object({
    type: z.literal("run.completed"),
    runId: runIdSchema,
    status: z.enum(["completed", "failed", "cancelled"]),
    usage: agentUsageSchema,
    finishedAt: timestampSchema,
    errorCode: z.string().optional(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const agentRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentRunSchema = z.object({
  id: runIdSchema,
  sessionId: sessionIdSchema,
  agentId: agentIdSchema,
  role: agentRoleSchema,
  parentRunId: runIdSchema.optional(),
  status: agentRunStatusSchema,
  modelId: z.string().min(1),
  steps: z.number().int().nonnegative(),
  limits: agentLimitsSchema,
  usage: agentUsageSchema,
  startedAt: timestampSchema,
  finishedAt: timestampSchema.optional(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

/**
 * Delegation policy handed to the runtime. Subagents only receive the tool
 * kinds they are granted here, never the parent's full registry.
 */
export const delegationPolicySchema = z.object({
  maxParallelSubagents: z.number().int().min(1).max(16),
  allowedToolKinds: z.array(z.enum([
    "files.read",
    "files.write",
    "files.edit",
    "files.patch",
    "search.ripgrep",
    "terminal.exec",
    "web.fetch",
    "code_map.query",
  ])),
  maxDepth: z.number().int().min(1).max(3),
});
export type DelegationPolicy = z.infer<typeof delegationPolicySchema>;
