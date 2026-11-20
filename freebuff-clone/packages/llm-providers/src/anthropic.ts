import { AppError } from "@freebuff/shared";
import type { AgentUsage } from "@freebuff/shared";
import { parseJsonObject, postJsonStream, readSse } from "./http";
import type { ProviderHttpOptions } from "./http";
import type {
  ChatMessage,
  ChatModel,
  ChatRequest,
  ModelStreamEvent,
  ToolSchema,
} from "./types";

/** Anthropic Messages API shim (streaming, tool_use blocks). */

interface AnthropicContentBlockStart {
  readonly type: string;
  readonly id?: string;
  readonly name?: string;
}

interface AnthropicStreamEvent {
  readonly type: string;
  readonly index?: number;
  readonly content_block?: AnthropicContentBlockStart;
  readonly delta?: {
    readonly type?: string;
    readonly text?: string;
    readonly partial_json?: string;
  };
  readonly message?: {
    readonly usage?: { readonly input_tokens?: number };
  };
  readonly usage?: { readonly output_tokens?: number };
}

interface AnthropicTextBlock {
  readonly type: "text";
  readonly text: string;
}

interface AnthropicToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
}

type AnthropicBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: AnthropicBlock[];
}

const toAnthropicMessages = (
  messages: readonly ChatMessage[],
): AnthropicMessage[] => {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId ?? "",
            content: message.content,
          },
        ],
      });
      continue;
    }
    if (message.role === "assistant") {
      const content: AnthropicBlock[] = [];
      if (message.content.length > 0) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parseJsonObject(call.arguments),
        });
      }
      out.push({
        role: "assistant",
        content:
          content.length > 0 ? content : [{ type: "text", text: "(no content)" }],
      });
      continue;
    }
    out.push({ role: "user", content: [{ type: "text", text: message.content }] });
  }
  return out;
};

const toAnthropicTools = (
  tools: readonly ToolSchema[],
): Record<string, unknown>[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { ...tool.parameters, type: "object" },
  }));

export interface AnthropicModelOptions {
  readonly http: ProviderHttpOptions;
  readonly id: string;
  readonly version?: string;
}

export class AnthropicModel implements ChatModel {
  readonly id: string;
  readonly provider = "anthropic" as const;
  private readonly http: ProviderHttpOptions;
  private readonly version: string;

  constructor(options: AnthropicModelOptions) {
    this.http = options.http;
    this.id = options.id;
    this.version = options.version ?? "2023-06-01";
  }

  async *stream(request: ChatRequest): AsyncGenerator<ModelStreamEvent> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const body = {
      model: this.id,
      system: system.length > 0 ? system : undefined,
      messages: toAnthropicMessages(request.messages),
      tools: toAnthropicTools(request.tools),
      max_tokens: request.maxOutputTokens,
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      stream: true,
    };

    const stream = await postJsonStream(this.http, {
      path: "/messages",
      body,
      signal: request.signal,
      extraHeaders: { "anthropic-version": this.version },
    });

    const pending = new Map<number, { id: string; name: string; json: string }>();
    let inputTokens = 0;

    for await (const data of readSse(stream)) {
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        throw new AppError({
          code: "provider_error",
          message: "Provider emitted malformed JSON",
          retryable: false,
        });
      }

      switch (event.type) {
        case "message_start": {
          inputTokens = event.message?.usage?.input_tokens ?? 0;
          break;
        }
        case "content_block_start": {
          if (
            event.content_block?.type === "tool_use" &&
            event.index !== undefined
          ) {
            pending.set(event.index, {
              id: event.content_block.id ?? `toolu_${String(event.index)}`,
              name: event.content_block.name ?? "",
              json: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta?.type === "text_delta" && event.delta.text !== undefined) {
            yield { type: "text.delta", delta: event.delta.text };
          }
          if (
            event.delta?.type === "input_json_delta" &&
            event.delta.partial_json !== undefined &&
            event.index !== undefined
          ) {
            const existing = pending.get(event.index);
            if (existing !== undefined) {
              existing.json += event.delta.partial_json;
            }
          }
          break;
        }
        case "content_block_stop": {
          if (event.index === undefined) {
            break;
          }
          const block = pending.get(event.index);
          if (block !== undefined) {
            pending.delete(event.index);
            if (block.name.length > 0) {
              yield {
                type: "tool.call",
                call: {
                  id: block.id,
                  name: block.name,
                  arguments: block.json.trim().length > 0 ? block.json : "{}",
                },
              };
            }
          }
          break;
        }
        case "message_delta": {
          const usage: AgentUsage = {
            inputTokens,
            outputTokens: event.usage?.output_tokens ?? 0,
          };
          yield { type: "usage", usage };
          break;
        }
        default:
          break;
      }
    }

    yield { type: "finish", reason: "stop" };
  }
}
