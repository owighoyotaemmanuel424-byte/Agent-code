import { AppError } from "@freebuff/shared";

/** Raised when tool arguments fail validation. Never retried blindly. */
export class ToolInputError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: "validation_failed", message, retryable: false, cause });
  }
}

/** Raised when a required runtime service is missing from the tool context. */
export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super({
      code: "tool_failed",
      message: `${service} is not available in this runtime context`,
      retryable: false,
    });
  }
}
