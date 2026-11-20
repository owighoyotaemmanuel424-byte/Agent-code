import { AppError } from "./errors";

/**
 * Retry, backoff, timeout and circuit-breaker primitives. Every external call
 * in the platform (model provider, web fetch, sandbox API, GitHub) goes through
 * these so behaviour is uniform and observable.
 */
export interface RetryPolicy {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4000,
};

export interface RetryEvent {
  readonly attempt: number;
  readonly delayMs: number;
  readonly error: unknown;
}

export interface RetryOptions {
  readonly signal?: AbortSignal;
  readonly isRetryable?: (error: unknown) => boolean;
  readonly onRetry?: (event: RetryEvent) => void;
  readonly random?: () => number;
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AppError({ code: "cancelled", message: "Aborted" }));
      return;
    }
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new AppError({ code: "cancelled", message: "Aborted" }));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Exponential backoff with bounded jitter in [0.5, 1] of the computed delay. */
export const backoffDelay = (
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number => {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  return Math.max(0, Math.round(capped * (0.5 + random() * 0.5)));
};

export const withRetry = async <TValue>(
  operation: (attempt: number) => Promise<TValue>,
  policy: RetryPolicy = defaultRetryPolicy,
  options: RetryOptions = {},
): Promise<TValue> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    if (options.signal?.aborted === true) {
      throw new AppError({ code: "cancelled", message: "Aborted before attempt" });
    }
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = options.isRetryable?.(error) ?? true;
      if (!retryable || attempt >= policy.attempts) {
        break;
      }
      const delayMs = backoffDelay(policy, attempt, options.random);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs, options.signal);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AppError({ code: "internal", message: "Operation failed" });
};

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly now?: () => number;
}

/**
 * Consecutive-failure circuit breaker. Once open it refuses requests until the
 * cooldown elapses, then allows exactly one probe (half-open).
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private failures = 0;
  private openedAt: number | undefined;
  private probing = false;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.cooldownMs = options.cooldownMs;
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.openedAt === undefined) {
      return "closed";
    }
    if (this.probing || this.now() - this.openedAt >= this.cooldownMs) {
      return "half_open";
    }
    return "open";
  }

  get failureCount(): number {
    return this.failures;
  }

  canRequest(): boolean {
    const state = this.state;
    if (state === "closed") {
      return true;
    }
    if (state === "open" || this.probing) {
      return false;
    }
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.probing = false;
  }

  recordFailure(): void {
    this.failures += 1;
    this.probing = false;
    if (this.failures >= this.failureThreshold) {
      this.openedAt = this.now();
    }
  }
}

export interface BreakerOptions {
  readonly message?: string;
  readonly shouldTrip?: (error: unknown) => boolean;
}

export const withCircuitBreaker = async <TValue>(
  breaker: CircuitBreaker,
  operation: () => Promise<TValue>,
  options: BreakerOptions = {},
): Promise<TValue> => {
  if (!breaker.canRequest()) {
    throw new AppError({
      code: "provider_error",
      message: options.message ?? "Circuit breaker is open",
      retryable: true,
    });
  }
  try {
    const value = await operation();
    breaker.recordSuccess();
    return value;
  } catch (error) {
    if (options.shouldTrip?.(error) ?? true) {
      breaker.recordFailure();
    }
    throw error;
  }
};

/**
 * Runs an operation with a hard deadline and an optional parent abort signal.
 * The operation receives a signal that fires on either condition.
 */
export const withTimeout = async <TValue>(
  operation: (signal: AbortSignal) => Promise<TValue>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TValue> => {
  const controller = new AbortController();
  const abortWith = (reason: unknown): void => {
    controller.abort(
      reason instanceof AppError
        ? reason
        : new AppError({ code: "cancelled", message: "Aborted" }),
    );
  };
  const timer = setTimeout(() => {
    abortWith(
      new AppError({
        code: "tool_timeout",
        message: `Operation timed out after ${timeoutMs}ms`,
        retryable: true,
      }),
    );
  }, timeoutMs);
  const onAbort = (): void => abortWith(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  const rejected = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        const reason: unknown = controller.signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new AppError({ code: "cancelled", message: "Aborted" }),
        );
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([operation(controller.signal), rejected]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};
