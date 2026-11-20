import { z } from "zod";
import { agentMessageSchema } from "./agent";
import { projectIdSchema, sessionIdSchema, userIdSchema } from "./ids";
import { surfaceSchema } from "./surfaces";
import { timestampSchema } from "./time";

export const projectRefSchema = z.object({
  kind: z.enum(["github", "sandbox", "local"]),
  id: projectIdSchema,
  name: z.string().min(1).max(200),
  repoUrl: z.string().url().optional(),
  defaultBranch: z.string().min(1).max(200).optional(),
});
export type ProjectRef = z.infer<typeof projectRefSchema>;

export const sessionStatusSchema = z.enum(["active", "archived"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * A session is the portable unit of context. History persists server-side and
 * is replayed identically on every surface.
 */
export const sessionSchema = z.object({
  id: sessionIdSchema,
  userId: userIdSchema,
  surface: surfaceSchema,
  title: z.string().min(1).max(200),
  modelId: z.string().min(1),
  project: projectRefSchema.optional(),
  messages: z.array(agentMessageSchema).max(5000),
  status: sessionStatusSchema,
  usageSeconds: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionSummarySchema = sessionSchema.pick({
  id: true,
  surface: true,
  title: true,
  modelId: true,
  status: true,
  updatedAt: true,
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
