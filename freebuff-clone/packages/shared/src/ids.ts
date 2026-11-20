import { z } from "zod";

/**
 * Opaque identifiers are branded so a SessionId can never be passed where an
 * AgentId is expected. Values are generated with `newId()` and never parsed
 * from user-controlled input without validation.
 */
const idSchema = z.string().min(1).max(128);

export const userIdSchema = idSchema.brand<"UserId">();
export const sessionIdSchema = idSchema.brand<"SessionId">();
export const agentIdSchema = idSchema.brand<"AgentId">();
export const runIdSchema = idSchema.brand<"RunId">();
export const toolCallIdSchema = idSchema.brand<"ToolCallId">();
export const projectIdSchema = idSchema.brand<"ProjectId">();
export const sandboxIdSchema = idSchema.brand<"SandboxId">();
export const adIdSchema = idSchema.brand<"AdId">();
export const workspaceIdSchema = idSchema.brand<"WorkspaceId">();

export type UserId = z.infer<typeof userIdSchema>;
export type SessionId = z.infer<typeof sessionIdSchema>;
export type AgentId = z.infer<typeof agentIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type ToolCallId = z.infer<typeof toolCallIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type SandboxId = z.infer<typeof sandboxIdSchema>;
export type AdId = z.infer<typeof adIdSchema>;
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;

/** Cryptographically random identifier. Safe for storage keys and audit ids. */
export const newId = (): string => crypto.randomUUID();
