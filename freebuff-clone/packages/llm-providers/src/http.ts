import { AppError, withCircuitBreaker, withTimeout } from "@freebuff/shared";
import type { CircuitBreaker, RetryPolicy } from "@freebuff/shared";

/** HTTP plumbing shared by all provider shims. */
export interface ProviderHttpOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly breaker: CircuitBreaker;
  readonly fetchImpl?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface JsonStreamRequest {
  readonly path: string;
  readonly body: unknown;
  readonly signal?: AbortSignal;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

const readErrorBody = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
};

/**
 * Opens a streaming POST. Connection timeouts use `withTimeout`; the body read
 * afterwards is bounded by the caller's consumption and the event buffer cap.
 */
export const postJsonStream = async (
  options: ProviderHttpOptions,
  request: JsonStreamRequest,
): Promise<ReadableStream<Uint8Array>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}${request.path}`;

  return withCircuitBreaker(
    options.breaker,
    async () => {
      let response: Response;
      try {
        response = await withTimeout(
          async (signal) =>
            fetchImpl(url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...options.headers,
                authorization: `Bearer ${options.apiKey}`,
                ...request.extraHeaders,
              },
              body: JSON.stringify(request.body),
              signal,
            }),
          options.timeoutMs,
          request.signal,
        );
      } catch (error) {
        if (error instanceof AppError) {
          throw error.code === "cancelled"
            ? error
            : new AppError({
                code: "provider_error",
                message: `Provider request failed: ${error.message}`,
                retryable: true,
                cause: error,
              });
        }
        throw new AppError({
          code: "provider_error",
          message: "Provider request failed",
          retryable: true,
          cause: error,
        });
      }

      if (!response.ok) {
        const detail = await readErrorBody(response);
        throw new AppError({
          code:
            response.status === 429 ? "provider_rate_limited" : "provider_error",
          message: `Provider returned ${response.status}${detail.length > 0 ? `: ${detail}` : ""}`,
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      if (response.body === null) {
        throw new AppError({
          code: "provider_error",
          message: "Provider returned an empty body",
          retryable: true,
        });
      }
      return response.body;
    },
    {
      message: "Model provider circuit breaker is open",
      shouldTrip: (error) =>
        !(error instanceof AppError) || error.retryable,
    },
  );
};

const MAX_EVENT_BYTES = 1_000_000;

/**
 * Server-sent events reader. Yields the payload of each `data:` line after the
 * blank-line delimiter, handling CRLF and multi-line events.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trimStart();
          if (trimmed.startsWith("data:")) {
            yield trimmed.slice("data:".length).trim();
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (buffer.length > MAX_EVENT_BYTES) {
        throw new AppError({
          code: "provider_error",
          message: "Provider event exceeded the buffer limit",
          retryable: false,
        });
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const defaultProviderRetry: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 5000,
};

export const parseJsonObject = (raw: string): Record<string, unknown> => {
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};
