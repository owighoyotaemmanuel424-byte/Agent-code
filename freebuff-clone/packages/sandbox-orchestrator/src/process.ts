import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { AppError } from "@freebuff/shared";

/**
 * Process helpers for the orchestrator control plane. Commands are always argv
 * arrays with a scrubbed environment and a hard timeout.
 */
export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface RunProcessOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxOutputChars?: number;
}

const SCRUBBED_ENV_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "SYSTEMROOT",
] as const;

export const scrubbedEnv = (
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> => {
  const env: Record<string, string> = { CI: "1" };
  for (const key of SCRUBBED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
};

export const runProcess = (
  command: string,
  args: readonly string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> => {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputChars = options.maxOutputChars ?? 200_000;
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...scrubbedEnv(options.env) },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= maxOutputChars) {
        return current;
      }
      return (current + chunk.toString("utf8")).slice(0, maxOutputChars);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (result: ProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(
        new AppError({
          code: "tool_failed",
          message: `Could not start ${command}`,
          cause: error,
        }),
      );
    });

    child.on("close", (code) => {
      finish({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
};

export interface DetachedProcess {
  readonly pid: number;
  readonly stop: () => void;
}

export const spawnDetached = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly onLog?: (line: string) => void;
  },
): DetachedProcess => {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: { ...scrubbedEnv(options.env) },
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (child.pid === undefined) {
    throw new AppError({
      code: "sandbox_failed",
      message: `Could not start ${command}`,
    });
  }

  const emit = (chunk: Buffer): void => {
    if (options.onLog === undefined) {
      return;
    }
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim().length > 0) {
        options.onLog(line);
      }
    }
  };
  child.stdout?.on("data", emit);
  child.stderr?.on("data", emit);
  child.unref();

  const pid = child.pid;
  return {
    pid,
    stop: () => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }
    },
  };
};

/** Allocates a free loopback port by binding to port 0. */
export const allocatePort = (): Promise<number> =>
  new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolvePromise(port);
      });
    });
  });
