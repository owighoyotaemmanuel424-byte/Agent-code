import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { AppError, defineTool } from "@freebuff/shared";
import { z } from "zod";
import { createTool } from "../registry";
import { ServiceUnavailableError } from "../errors";
import type { CommandOptions, CommandResult, CommandRunner } from "./context";

/**
 * Local command broker. Runs argv arrays with `shell: false`, a scrubbed
 * environment, a hard timeout and truncated output, so agent stdio and secrets
 * are never exposed to the command. In the cloud this is replaced by sandboxed
 * execution from @freebuff/sandbox-orchestrator.
 */
export class ProcessCommandRunner implements CommandRunner {
  constructor(private readonly root: string) {}

  run(
    command: string,
    args: readonly string[],
    options: CommandOptions,
  ): Promise<CommandResult> {
    const cwd = resolve(this.root, options.cwd ?? ".");
    const startedAt = Date.now();
    const env: Record<string, string> = { CI: "1" };
    for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"] as const) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }

    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;

      const child = spawn(command, [...args], {
        cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const append = (current: string, chunk: Buffer): string => {
        if (current.length >= options.maxOutputBytes) {
          truncated = true;
          return current;
        }
        const remaining = options.maxOutputBytes - current.length;
        const text = chunk.toString("utf8");
        if (text.length > remaining) {
          truncated = true;
          return current + text.slice(0, remaining);
        }
        return current + text;
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
      }, options.timeoutMs);

      const onAbort = (): void => {
        child.kill("SIGKILL");
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        rejectPromise(
          new AppError({
            code: "tool_failed",
            message: `Could not start ${command}: ${error.message}`,
            cause: error,
          }),
        );
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolvePromise({
          exitCode: code ?? -1,
          stdout,
          stderr,
          timedOut,
          truncated,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}

const COMMAND_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export const runCommandTool = createTool(
  defineTool({
    name: "run_command",
    kind: "terminal.exec",
    description:
      "Run a program with explicit arguments. No shell is involved, so piping and redirection are not available.",
    parameters: z.object({
      command: z
        .string()
        .min(1)
        .max(256)
        .regex(COMMAND_NAME, "command must be a program name, not a shell line"),
      args: z.array(z.string().max(4096)).max(64).optional(),
      cwd: z.string().min(1).max(1024).optional().describe("Workspace-relative directory"),
      timeoutMs: z.number().int().min(100).max(600_000).optional(),
    }),
    mutating: true,
    timeoutMs: 610_000,
  }),
  async (args, context) => {
    if (context.terminal === undefined) {
      throw new ServiceUnavailableError("Command execution");
    }
    const cwd =
      args.cwd === undefined ? undefined : context.workspace.absolutePath(args.cwd);
    const result = await context.terminal.run(args.command, args.args ?? [], {
      ...(cwd === undefined ? {} : { cwd }),
      timeoutMs: args.timeoutMs ?? 120_000,
      maxOutputBytes: 100_000,
      signal: context.signal,
    });
    return result;
  },
);
