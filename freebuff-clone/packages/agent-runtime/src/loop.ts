import type { ChatMessage, ChatModel, ChatToolCall } from "@freebuff/llm-providers";
import { parseJsonObject } from "@freebuff/llm-providers";
import {
  AppError,
  defaultRetryPolicy,
  newId,
  nowIso,
  toolCallId,
  withRetry,
} from "@freebuff/shared";
import type {
  AgentEvent,
  AgentId,
  AgentLimits,
  AgentMessage,
  AgentUsage,
  RetryPolicy,
  RunId,
  SessionId,
  Surface,
  ToolResult,
} from "@freebuff/shared";
import type { ToolRegistry } from "./registry";
import type { ToolExecutionContext } from "./tools/context";

export interface RunAgentOptions {
  readonly model: ChatModel;
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly runId: RunId;
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly surface: Surface;
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly limits: AgentLimits;
  readonly registry: ToolRegistry;
  readonly context: ToolExecutionContext;
  readonly emit: (event: AgentEvent) => void;
  readonly signal: AbortSignal;
  readonly retry?: RetryPolicy;
}

export interface AgentRunOutcome {
  readonly runId: RunId;
  readonly status: "completed" | "failed" | "cancelled";
  readonly messages: readonly AgentMessage[];
  readonly usage: AgentUsage;
  readonly steps: number;
  readonly summary: string;
  readonly errorCode?: string;
}

const addUsage = (total: AgentUsage, delta: AgentUsage): AgentUsage => ({
  inputTokens: total.inputTokens + delta.inputTokens,
  outputTokens: total.outputTokens + delta.outputTokens,
  ...(delta.cachedInputTokens === undefined
    ? {}
    : { cachedInputTokens: (total.cachedInputTokens ?? 0) + delta.cachedInputTokens }),
});

const toChatMessages = (
  systemPrompt: string,
  messages: readonly AgentMessage[],
): ChatMessage[] => {
  const out: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        content: message.content,
        ...(message.toolCallId === undefined
          ? {}
          : { toolCallId: String(message.toolCallId) }),
      });
      continue;
    }
    if (message.role === "assistant") {
      const calls: ChatToolCall[] = (message.toolCalls ?? []).map((call) => ({
        id: String(call.id),
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      }));
      out.push({
        role: "assistant",
        content: message.content,
        ...(calls.length === 0 ? {} : { toolCalls: calls }),
      });
      continue;
    }
    out.push({ role: message.role, content: message.content });
  }
  return out;
};

const MAX_TOOL_MESSAGE_CHARS = 8000;

const serializeResult = (result: ToolResult): string => {
  if (result.status === "error") {
    return JSON.stringify({ status: "error", error: result.error });
  }
  if (result.status === "cancelled") {
    return JSON.stringify({ status: "cancelled" });
  }
  const text =
    typeof result.output === "string"
      ? result.output
      : JSON.stringify(result.output) ?? "";
  return text.length > MAX_TOOL_MESSAGE_CHARS
    ? `${text.slice(0, MAX_TOOL_MESSAGE_CHARS)}\n[output truncated]`
    : text;
};

/**
 * One agent run: model → tool calls → results → repeat. The loop stops on a
 * final answer, the step budget, the token budget, the wall-clock budget or
 * cancellation, and always emits exactly one `run.completed` event.
 */
export const runAgent = async (
  options: RunAgentOptions,
): Promise<AgentRunOutcome> => {
  const { emit, registry, limits, signal } = options;
  const runId = options.runId;
  const history: AgentMessage[] = [...options.messages];
  const tools = registry.schemas();
  const startedAtMs = Date.now();

  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let steps = 0;
  let status: AgentRunOutcome["status"] = "completed";
  let errorCode: string | undefined;
  let summary = "";
  let exitedEarly = false;

  emit({
    type: "run.started",
    runId,
    sessionId: options.sessionId,
    agentId: options.agentId,
    surface: options.surface,
    startedAt: nowIso(),
  });

  try {
    while (steps < limits.maxSteps) {
      if (signal.aborted) {
        status = "cancelled";
        errorCode = "cancelled";
        exitedEarly = true;
        break;
      }
      if (Date.now() - startedAtMs > limits.maxWallClockMs) {
        status = "failed";
        errorCode = "wall_clock_exceeded";
        exitedEarly = true;
        break;
      }
      if (usage.inputTokens + usage.outputTokens >= limits.maxTokens) {
        status = "failed";
        errorCode = "token_budget_exceeded";
        exitedEarly = true;
        break;
      }

      steps += 1;
      const messageId = newId();
      let text = "";
      let calls: ChatToolCall[] = [];

      try {
        let emitted = false;
        await withRetry(
          async () => {
            text = "";
            calls = [];
            emitted = false;
            for await (const event of options.model.stream({
              model: options.modelId,
              messages: toChatMessages(options.systemPrompt, history),
              tools,
              maxOutputTokens: options.maxOutputTokens,
              signal,
            })) {
              switch (event.type) {
                case "text.delta":
                  emitted = true;
                  text += event.delta;
                  emit({ type: "message.delta", runId, messageId, delta: event.delta });
                  break;
                case "tool.call":
                  emitted = true;
                  calls.push(event.call);
                  break;
                case "usage":
                  emitted = true;
                  usage = addUsage(usage, event.usage);
                  emit({ type: "usage", runId, usage: event.usage });
                  break;
                case "finish":
                  break;
              }
            }
          },
          options.retry ?? defaultRetryPolicy,
          {
            signal,
            isRetryable: (error) =>
              !emitted && (error instanceof AppError ? error.retryable : true),
          },
        );
      } catch (error) {
        if (signal.aborted) {
          status = "cancelled";
          errorCode = "cancelled";
        } else {
          status = "failed";
          errorCode = error instanceof AppError ? error.code : "provider_error";
        }
        exitedEarly = true;
        break;
      }

      const assistant: AgentMessage = {
        id: messageId,
        role: "assistant",
        content: text,
        createdAt: nowIso(),
        ...(calls.length === 0
          ? {}
          : {
              toolCalls: calls.map((call) => ({
                id: toolCallId(call.id),
                name: call.name,
                arguments: parseJsonObject(call.arguments),
              })),
            }),
      };
      history.push(assistant);
      emit({ type: "message.completed", runId, message: assistant });
      summary = text;

      if (calls.length === 0) {
        exitedEarly = true;
        break;
      }

      for (const call of calls) {
        const id = toolCallId(call.id);
        emit({ type: "tool.started", runId, callId: id, name: call.name });
        const result = await registry.execute(
          {
            id,
            name: call.name,
            arguments: parseJsonObject(call.arguments),
          },
          options.context,
        );
        emit({ type: "tool.finished", runId, result });
        history.push({
          id: newId(),
          role: "tool",
          content: serializeResult(result),
          toolCallId: id,
          createdAt: nowIso(),
        });
        if (signal.aborted) {
          status = "cancelled";
          errorCode = "cancelled";
          exitedEarly = true;
          break;
        }
      }

      if (exitedEarly) {
        break;
      }
    }

    if (!exitedEarly && status === "completed") {
      status = "failed";
      errorCode = "step_budget_exceeded";
    }
  } catch (error) {
    status = signal.aborted ? "cancelled" : "failed";
    errorCode = error instanceof AppError ? error.code : "internal";
  } finally {
    emit({
      type: "run.completed",
      runId,
      status,
      usage,
      finishedAt: nowIso(),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  }

  return {
    runId,
    status,
    messages: history,
    usage,
    steps,
    summary,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
};
