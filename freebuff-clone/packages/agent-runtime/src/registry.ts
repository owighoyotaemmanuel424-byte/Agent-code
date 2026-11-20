import { AppError, withTimeout } from "@freebuff/shared";
import type { ToolCall, ToolDefinition, ToolResult } from "@freebuff/shared";
import { z } from "zod";
import type { ToolSchema } from "@freebuff/llm-providers";
import type { ToolExecutionContext } from "./tools/context";
import { ToolInputError } from "./errors";

export interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: (args: unknown, context: ToolExecutionContext) => Promise<unknown>;
}

/**
 * Registers a tool and its handler. Arguments are validated against the
 * definition's Zod schema before the handler sees them, so handlers can assume
 * a well-formed input object.
 */
export const createTool = <TParameters extends z.ZodType>(
  definition: ToolDefinition<TParameters>,
  handler: (
    args: z.infer<TParameters>,
    context: ToolExecutionContext,
  ) => Promise<unknown>,
): RegisteredTool => ({
  definition,
  handler: async (raw, context) => {
    const parsed = definition.parameters.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ToolInputError(`Invalid arguments for ${definition.name}: ${detail}`);
    }
    return handler(parsed.data, context);
  },
});

const toJsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const generated: unknown = z.toJSONSchema(schema, { io: "input" });
  if (typeof generated !== "object" || generated === null) {
    throw new AppError({
      code: "internal",
      message: "Failed to generate a JSON schema for a tool",
    });
  }
  return generated as Record<string, unknown>;
};

const asToolError = (
  error: unknown,
): { code: "invalid_arguments" | "not_permitted" | "not_found" | "timeout" | "failed"; message: string; retryable: boolean } => {
  if (error instanceof AppError) {
    switch (error.code) {
      case "validation_failed":
        return { code: "invalid_arguments", message: error.message, retryable: false };
      case "forbidden":
        return { code: "not_permitted", message: error.message, retryable: false };
      case "not_found":
        return { code: "not_found", message: error.message, retryable: false };
      case "tool_timeout":
        return { code: "timeout", message: error.message, retryable: true };
      case "cancelled":
        return { code: "failed", message: error.message, retryable: false };
      default:
        return { code: "failed", message: error.message, retryable: error.retryable };
    }
  }
  return {
    code: "failed",
    message: error instanceof Error ? error.message : "Tool execution failed",
    retryable: false,
  };
};

/** Executes tool calls. Never throws: every failure is a typed ToolResult. */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): this {
    if (this.tools.has(tool.definition.name)) {
      throw new AppError({
        code: "conflict",
        message: `Tool "${tool.definition.name}" is already registered`,
      });
    }
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  schemas(): ToolSchema[] {
    return this.list().map((tool) => ({
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: toJsonSchema(tool.definition.parameters),
    }));
  }

  async execute(
    call: ToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const startedAt = Date.now();
    const duration = (): number => Date.now() - startedAt;
    const tool = this.tools.get(call.name);

    if (tool === undefined) {
      return {
        status: "error",
        callId: call.id,
        error: {
          code: "not_found",
          message: `Unknown tool: ${call.name}`,
          retryable: false,
        },
        durationMs: duration(),
      };
    }

    try {
      const output = await withTimeout(
        (signal) => tool.handler(call.arguments, { ...context, signal }),
        tool.definition.timeoutMs,
        context.signal,
      );
      return { status: "ok", callId: call.id, output, durationMs: duration() };
    } catch (error) {
      if (error instanceof AppError && error.code === "cancelled") {
        return { status: "cancelled", callId: call.id, durationMs: duration() };
      }
      return {
        status: "error",
        callId: call.id,
        error: asToolError(error),
        durationMs: duration(),
      };
    }
  }
}
