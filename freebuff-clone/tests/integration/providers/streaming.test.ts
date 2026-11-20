import { createServer } from "node:http";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { AnthropicModel, OpenAiCompatibleModel } from "@freebuff/llm-providers";
import { CircuitBreaker } from "@freebuff/shared";
import type { AppError } from "@freebuff/shared";

/**
 * Exercises the provider shims over a real HTTP connection with a local SSE
 * server, so stream parsing and tool-call assembly are tested end to end.
 */
interface TestServer {
  readonly url: string;
  readonly headers: () => IncomingHttpHeaders;
  readonly close: () => Promise<void>;
}

const startServer = async (
  handler: (response: ServerResponse) => void,
): Promise<TestServer> => {
  let captured: IncomingHttpHeaders = {};
  const server = createServer((request, response) => {
    captured = request.headers;
    request.resume();
    request.on("end", () => {
      handler(response);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    headers: () => captured,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

const sse = (events: readonly string[]): string =>
  events.map((event) => `data: ${event}\n\n`).join("");

const breaker = (): CircuitBreaker =>
  new CircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 });

const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of source) {
    events.push(event);
  }
  return events;
};

const baseRequest = {
  model: "test-model",
  messages: [{ role: "user" as const, content: "hello" }],
  tools: [
    {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  ],
  maxOutputTokens: 256,
};

describe("OpenAI-compatible streaming", () => {
  it("assembles text, split tool-call argument deltas and usage", async () => {
    const body = sse([
      '{"choices":[{"delta":{"content":"Hel"}}]}',
      '{"choices":[{"delta":{"content":"lo"}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.txt\\"}"}}]}}]}',
      '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      '{"usage":{"prompt_tokens":11,"completion_tokens":7},"choices":[]}',
      "[DONE]",
    ]);
    const server = await startServer((response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(body);
    });
    try {
      const model = new OpenAiCompatibleModel({
        http: {
          apiKey: "test-key",
          baseUrl: server.url,
          timeoutMs: 5000,
          breaker: breaker(),
        },
        provider: "openai",
        id: "test-model",
      });

      const events = await collect(model.stream(baseRequest));
      const text = events
        .filter((event) => event.type === "text.delta")
        .map((event) => (event.type === "text.delta" ? event.delta : ""))
        .join("");
      expect(text).toBe("Hello");

      const call = events.find((event) => event.type === "tool.call");
      expect(call?.type === "tool.call" && call.call.name).toBe("read_file");
      expect(call?.type === "tool.call" && call.call.id).toBe("call_1");
      expect(call?.type === "tool.call" && call.call.arguments).toBe(
        '{"path":"a.txt"}',
      );

      const usage = events.find((event) => event.type === "usage");
      expect(usage?.type === "usage" && usage.usage).toEqual({
        inputTokens: 11,
        outputTokens: 7,
      });
      expect(events.at(-1)).toEqual({ type: "finish", reason: "tool_calls" });
      expect(server.headers().authorization).toBe("Bearer test-key");
    } finally {
      await server.close();
    }
  });

  it("surfaces a 429 as a retryable provider error", async () => {
    const server = await startServer((response) => {
      response.writeHead(429, { "content-type": "application/json" });
      response.end('{"error":"rate limited"}');
    });
    try {
      const model = new OpenAiCompatibleModel({
        http: {
          apiKey: "k",
          baseUrl: server.url,
          timeoutMs: 5000,
          breaker: breaker(),
        },
        provider: "deepseek",
        id: "test-model",
      });
      await expect(collect(model.stream(baseRequest))).rejects.toMatchObject({
        code: "provider_rate_limited",
      } satisfies Partial<AppError>);
    } finally {
      await server.close();
    }
  });
});

describe("Anthropic streaming", () => {
  it("assembles text blocks and tool_use input JSON", async () => {
    const body = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    const server = await startServer((response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(body);
    });
    try {
      const model = new AnthropicModel({
        http: {
          apiKey: "k",
          baseUrl: server.url,
          timeoutMs: 5000,
          breaker: breaker(),
        },
        id: "test-model",
      });

      const events = await collect(model.stream(baseRequest));
      const text = events
        .filter((event) => event.type === "text.delta")
        .map((event) => (event.type === "text.delta" ? event.delta : ""))
        .join("");
      expect(text).toBe("Hi");

      const call = events.find((event) => event.type === "tool.call");
      expect(call?.type === "tool.call" && call.call.id).toBe("toolu_1");
      expect(call?.type === "tool.call" && call.call.arguments).toBe(
        '{"path":"a.txt"}',
      );

      const usage = events.find((event) => event.type === "usage");
      expect(usage?.type === "usage" && usage.usage).toEqual({
        inputTokens: 12,
        outputTokens: 9,
      });
      expect(server.headers()["anthropic-version"]).toBe("2023-06-01");
    } finally {
      await server.close();
    }
  });
});
