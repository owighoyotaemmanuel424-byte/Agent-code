import { z } from "zod";
import { toolCallIdSchema } from "./ids";
import type { ToolCallId } from "./ids";

/** snake_case tool names, stable across providers and prompt formats. */
export const toolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,63}$/, "Tool names must be snake_case");

export type ToolName = z.infer<typeof toolNameSchema>;

/**
 * Tool capabilities the runtime knows how to execute. `files.patch` is the
 * coordinated multi-file edit path; `subagent.delegate` fans out to child runs.
 */
export const toolKindSchema = z.enum([
  "files.read",
  "files.write",
  "files.edit",
  "files.patch",
  "search.ripgrep",
  "terminal.exec",
  "web.fetch",
  "code_map.query",
  "subagent.delegate",
]);

export type ToolKind = z.infer<typeof toolKindSchema>;

export const toolCallSchema = z.object({
  id: toolCallIdSchema,
  name: toolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const toolCallSchemaInput = z.object({
  id: z.string().min(1),
  name: toolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

export const toolErrorSchema = z.object({
  code: z.enum(["invalid_arguments", "not_permitted", "not_found", "timeout", "failed"]),
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type ToolError = z.infer<typeof toolErrorSchema>;

export const toolResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    callId: toolCallIdSchema,
    output: z.unknown(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("error"),
    callId: toolCallIdSchema,
    error: toolErrorSchema,
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("cancelled"),
    callId: toolCallIdSchema,
    durationMs: z.number().nonnegative(),
  }),
]);
export type ToolResult = z.infer<typeof toolResultSchema>;

/**
 * A tool definition is code plus a Zod parameter schema. Providers receive a
 * JSON schema generated from `parameters`; validation always runs locally.
 */
export interface ToolDefinition<TParameters extends z.ZodType = z.ZodType> {
  readonly name: ToolName;
  readonly kind: ToolKind;
  readonly description: string;
  readonly parameters: TParameters;
  /** True when the tool can mutate the workspace, so approvals can be scoped. */
  readonly mutating: boolean;
  readonly timeoutMs: number;
}

export const defineTool = <TParameters extends z.ZodType>(
  definition: ToolDefinition<TParameters>,
): ToolDefinition<TParameters> => definition;

export const toolCallId = (value: string): ToolCallId =>
  value as unknown as ToolCallId;
