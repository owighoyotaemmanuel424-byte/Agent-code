import { describe, expect, it } from "vitest";
import {
  AppError,
  CircuitBreaker,
  backoffDelay,
  withCircuitBreaker,
  withRetry,
  withTimeout,
} from "@freebuff/shared";

describe("backoff", () => {
  it("grows exponentially and respects the ceiling", () => {
    const policy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 1000 };
    const alwaysFull = (): number => 1;
    expect(backoffDelay(policy, 1, alwaysFull)).toBe(100);
    expect(backoffDelay(policy, 2, alwaysFull)).toBe(200);
    expect(backoffDelay(policy, 3, alwaysFull)).toBe(400);
    expect(backoffDelay(policy, 8, alwaysFull)).toBe(1000);
  });

  it("applies jitter within the lower half of the delay", () => {
    const policy = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000 };
    // Attempt 1 has a 100ms base: jitter halves it to 50ms at random() === 0.
    expect(backoffDelay(policy, 1, () => 0)).toBe(50);
    expect(backoffDelay(policy, 1, () => 1)).toBe(100);
    // Attempt 2 doubles the base to 200ms before jitter.
    expect(backoffDelay(policy, 2, () => 0)).toBe(100);
    expect(backoffDelay(policy, 2, () => 1)).toBe(200);
  });
});

describe("withRetry", () => {
  it("retries until success", async () => {
    let attempts = 0;
    const value = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new AppError({ code: "provider_error", message: "transient" });
        }
        return "ok";
      },
      { attempts: 5, baseDelayMs: 1, maxDelayMs: 1 },
      { random: () => 1 },
    );
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not retry a non-retryable failure", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new AppError({
            code: "validation_failed",
            message: "bad input",
            retryable: false,
          });
        },
        { attempts: 4, baseDelayMs: 1, maxDelayMs: 1 },
        { isRetryable: (error) => error instanceof AppError && error.retryable },
      ),
    ).rejects.toThrow("bad input");
    expect(attempts).toBe(1);
  });

  it("stops immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withRetry(async () => "never", { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }, {
        signal: controller.signal,
      }),
    ).rejects.toThrow("Aborted");
  });
});

describe("circuit breaker", () => {
  it("opens after the failure threshold and half-opens after cooldown", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1000,
      now: () => now,
    });
    const failing = async (): Promise<never> => {
      throw new AppError({ code: "provider_error", message: "down", retryable: true });
    };

    await expect(withCircuitBreaker(breaker, failing)).rejects.toThrow("down");
    expect(breaker.state).toBe("closed");
    await expect(withCircuitBreaker(breaker, failing)).rejects.toThrow("down");
    expect(breaker.state).toBe("open");
    expect(breaker.canRequest()).toBe(false);

    now = 1000;
    expect(breaker.state).toBe("half_open");

    // The probe request itself is what closes the breaker again.
    await expect(
      withCircuitBreaker(breaker, async () => "recovered"),
    ).resolves.toBe("recovered");
    expect(breaker.state).toBe("closed");
  });

  it("does not trip on a non-retryable error when configured", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    await expect(
      withCircuitBreaker(
        breaker,
        async () => {
          throw new AppError({ code: "validation_failed", message: "bad" });
        },
        { shouldTrip: (error) => error instanceof AppError && error.retryable },
      ),
    ).rejects.toThrow("bad");
    expect(breaker.state).toBe("closed");
  });
});

describe("withTimeout", () => {
  it("rejects when the deadline passes", async () => {
    await expect(
      withTimeout(() => new Promise(() => undefined), 10),
    ).rejects.toThrow(/timed out/i);
  });

  it("resolves before the deadline", async () => {
    await expect(withTimeout(async () => "fast", 100)).resolves.toBe("fast");
  });
});
