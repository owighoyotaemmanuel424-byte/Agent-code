import { AppError } from "@freebuff/shared";
import { runProcess } from "./process";

/** Clone helpers. Tokens are injected per operation and never logged. */

export const redactUrl = (value: string): string =>
  value.replace(/\/\/[^@/\s]+@/, "//***@");

export interface CloneUrlOptions {
  /** Development only: allow `file://` remotes for local fixtures. */
  readonly allowFileProtocol?: boolean;
}

export const buildCloneUrl = (
  repoUrl: string,
  token?: string,
  options: CloneUrlOptions = {},
): string => {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new AppError({
      code: "validation_failed",
      message: `Not a valid repository URL: ${redactUrl(repoUrl)}`,
    });
  }
  const allowedProtocol =
    parsed.protocol === "https:" ||
    (options.allowFileProtocol === true && parsed.protocol === "file:");
  if (!allowedProtocol) {
    throw new AppError({
      code: "validation_failed",
      message: "Only HTTPS repository URLs can be cloned",
    });
  }
  if (parsed.protocol === "file:") {
    return parsed.toString();
  }
  if (token !== undefined && token.length > 0) {
    parsed.username = "x-access-token";
    parsed.password = token;
  }
  return parsed.toString();
};

export interface CloneOptions {
  readonly repoUrl: string;
  readonly destination: string;
  readonly token?: string;
  readonly ref?: string;
  readonly timeoutMs?: number;
  readonly allowFileProtocol?: boolean;
}

export interface CloneResult {
  readonly destination: string;
  readonly elapsedMs: number;
  readonly redactedUrl: string;
}

export const cloneRepository = async (
  options: CloneOptions,
): Promise<CloneResult> => {
  const url = buildCloneUrl(options.repoUrl, options.token, {
    ...(options.allowFileProtocol === true ? { allowFileProtocol: true } : {}),
  });
  const startedAt = Date.now();
  const args = [
    "clone",
    "--depth",
    "1",
    ...(options.ref === undefined ? [] : ["--branch", options.ref]),
    url,
    options.destination,
  ];
  const result = await runProcess("git", args, {
    timeoutMs: options.timeoutMs ?? 120_000,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.timedOut || result.exitCode !== 0) {
    throw new AppError({
      code: "sandbox_failed",
      message: `Clone failed for ${redactUrl(options.repoUrl)}: ${
        result.timedOut ? "timed out" : result.stderr.trim().slice(0, 300)
      }`,
    });
  }
  return {
    destination: options.destination,
    elapsedMs: Date.now() - startedAt,
    redactedUrl: redactUrl(url),
  };
};
