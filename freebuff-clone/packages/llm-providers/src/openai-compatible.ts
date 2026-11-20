import { AppError } from "@freebuff/shared";
import type { AgentUsage, ModelProvider } from "@freebuff/shared";
import { postJsonStream, readSse } from "./http";
import type { ProviderHttpOptions } from "./http";
import type {
  ChatMessage,
  ChatModel,
  ChatRequest,
  ModelStreamEvent,
  ToolSchema,
} from "./types";

/**
 * OpenAI-compatible chat completions shim. Used directly for OpenAI and, with a
 * different base URL, for DeepSeek.
 */

interface OpenAiToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface OpenAiChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly OpenAiToolCallDelta[];
    };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

const toOpenAiMessages = (
  messages: readonly ChatMessage[],
): Record<string, unknown>[] =>
  messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content,
      };
    }
    if (message.role === "assistant") {
      const calls = message.toolCalls ?? [];
      return {
        role: "assistant",
        content: message.content,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    }
    return { role: message.role, content: message.content };
  });

const toOpenAiTools = (
  tools: readonly ToolSchema[],
): Record<string, unknown>[] =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

export interface OpenAiCompatibleOptions {
  readonly http: ProviderHttpOptions;
  readonly provider: Extract<ModelProvider, "openai" | "deepseek">;
  readonly id: string;
}

export class OpenAiCompatibleModel implements ChatModel {
  readonly id: string;
  readonly provider: OpenAiCompatibleOptions["provider"];
  private readonly http: ProviderHttpOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.http = options.http;
    this.provider = options.provider;
    this.id = options.id;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ModelStreamEvent> {
    const body = {
      model: this.id,
      messages: toOpenAiMessages(request.messages),
      tools: toOpenAiTools(request.tools),
      tool_choice: request.tools.length > 0 ? "auto" : "none",
      max_tokens: request.maxOutputTokens,
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      stream: true,
      stream_options: { include_usage: true },
    };

    const stream = await postJsonStream(this.http, {
      path: "/chat/completions",
      body,
      signal: request.signal,
    });

    const pending = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason = "stop";

    for await (const data of readSse(stream)) {
      if (data === "[DONE]") {
        break;
      }
      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(data) as OpenAiChunk;
      } catch {
        throw new AppError({
          code: "provider_error",
          message: "Provider emitted malformed JSON",
          retryable: false,
        });
      }

      if (chunk.usage !== undefined) {
        const usage: AgentUsage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
        yield { type: "usage", usage };
      }

      const choice = chunk.choices?.[0];
      if (choice === undefined) {
        continue;
      }

      const text = choice.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield { type: "text.delta", delta: text };
      }

      for (const delta of choice.delta?.tool_calls ?? []) {
        const existing = pending.get(delta.index) ?? {
          id: `call_${String(delta.index)}`,
          name: "",
          arguments: "",
        };
        pending.set(delta.index, {
          id: delta.id ?? existing.id,
          name: delta.function?.name ?? existing.name,
          arguments: existing.arguments + (delta.function?.arguments ?? ""),
        });
      }

      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        finishReason = choice.finish_reason;
      }
    }

    const ordered = [...pending.entries()].sort(([a], [b]) => a - b);
    for (const [, call] of ordered) {
      if (call.name.length === 0) {
        continue;
      }
      yield {
        type: "tool.call",
        call: {
          id: call.id,
          name: call.name,
          arguments: call.arguments.trim().length > 0 ? call.arguments : "{}",
        },
      };
    }

    yield {
      type: "finish",
      reason:
        ordered.length > 0
          ? "tool_calls"
          : finishReason === "length"
            ? "length"
            : "stop",
    };
  }
}
