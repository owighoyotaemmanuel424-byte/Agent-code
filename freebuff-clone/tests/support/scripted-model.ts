import type { ChatModel, ChatRequest, ModelStreamEvent } from "@freebuff/llm-providers";
import type { AgentUsage } from "@freebuff/shared";

/**
 * Test double: replays scripted turns so the agent loop can be exercised
 * deterministically. Lives under tests/ and is never imported by a production
 * path.
 */
export interface ScriptedToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly id?: string;
}

export interface ScriptedTurn {
  readonly text?: string;
  readonly toolCalls?: readonly ScriptedToolCall[];
  readonly usage?: AgentUsage;
  readonly failWith?: Error;
}

const splitIntoChunks = (text: string, size: number): string[] => {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length === 0 ? [""] : chunks;
};

export class ScriptedModel implements ChatModel {
  readonly id = "scripted-model";
  readonly provider = "openai" as const;
  readonly requests: ChatRequest[] = [];
  private readonly turns: readonly ScriptedTurn[];
  private cursor = 0;

  constructor(turns: readonly ScriptedTurn[]) {
    this.turns = turns;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    const turn = this.turns[this.cursor];
    this.cursor += 1;
    if (turn === undefined) {
      throw new Error("ScriptedModel ran out of scripted turns");
    }
    if (turn.failWith !== undefined) {
      throw turn.failWith;
    }

    if (request.signal?.aborted === true) {
      return;
    }

    const text = turn.text ?? "";
    if (text.length > 0) {
      for (const chunk of splitIntoChunks(text, 8)) {
        yield { type: "text.delta", delta: chunk };
      }
    }

    let index = 0;
    for (const call of turn.toolCalls ?? []) {
      index += 1;
      yield {
        type: "tool.call",
        call: {
          id: call.id ?? `call_${String(this.cursor)}_${String(index)}`,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      };
    }

    yield {
      type: "usage",
      usage: turn.usage ?? { inputTokens: 120, outputTokens: 30 },
    };
    yield {
      type: "finish",
      reason: (turn.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop",
    };
  }
}
