import type { AgentUsage, ModelProvider } from "@freebuff/shared";

/**
 * The only model interface the agent runtime knows. Providers translate this
 * into their own wire format; nothing above this layer is provider-specific.
 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw JSON string exactly as emitted by the provider, validated downstream. */
  readonly arguments: string;
}

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  readonly toolCalls?: readonly ChatToolCall[];
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  /** JSON Schema generated from the tool's Zod parameter schema. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSchema[];
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export const finishReasonSchemaValues = [
  "stop",
  "tool_calls",
  "length",
  "error",
] as const;

export type FinishReason = (typeof finishReasonSchemaValues)[number];

/** Streaming events a provider must produce. Ordering is guaranteed. */
export type ModelStreamEvent =
  | { readonly type: "text.delta"; readonly delta: string }
  | { readonly type: "tool.call"; readonly call: ChatToolCall }
  | { readonly type: "usage"; readonly usage: AgentUsage }
  | { readonly type: "finish"; readonly reason: FinishReason };

export interface ChatModel {
  readonly id: string;
  readonly provider: ModelProvider;
  stream(request: ChatRequest): AsyncIterable<ModelStreamEvent>;
}
