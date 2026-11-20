import { z } from "zod";

/**
 * Machine-readable error codes shared by every surface and service.
 * Messages must never contain prompts, source code, tokens or credentials.
 */
export const errorCodeSchema = z.enum([
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "quota_exceeded",
  "verification_required",
  "provider_error",
  "provider_rate_limited",
  "tool_failed",
  "tool_timeout",
  "sandbox_failed",
  "sandbox_unavailable",
  "cancelled",
  "internal",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export interface AppErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(options: AppErrorOptions) {
    super(
      options.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "AppError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError;

/** Wire-safe error shape. Details are non-sensitive by construction. */
export const errorPayloadSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});

export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

export const toErrorPayload = (error: unknown): ErrorPayload => {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: "internal",
    message: error instanceof Error ? error.message : "Unexpected error",
    retryable: false,
  };
};

export class QuotaExceededError extends AppError {
  constructor(message = "Hour quota exhausted") {
    super({ code: "quota_exceeded", message });
  }
}

export class VerificationRequiredError extends AppError {
  constructor(message = "Phone verification required for the free tier") {
    super({ code: "verification_required", message });
  }
}

export class ProviderError extends AppError {
  constructor(
    message: string,
    options: { readonly retryable?: boolean; readonly cause?: unknown } = {},
  ) {
    super({
      code: "provider_error",
      message,
      retryable: options.retryable ?? true,
      cause: options.cause,
    });
  }
}

export class ToolFailedError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: "tool_failed", message, cause });
  }
}

export class SandboxError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: "sandbox_failed", message, retryable: true, cause });
  }
}
