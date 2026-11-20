import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError, nowIso } from "@freebuff/shared";
import type { SandboxId } from "@freebuff/shared";
import { detectStack, nodeFileReader, withPort } from "./detect";
import { cloneRepository } from "./git";
import { allocatePort, runProcess, spawnDetached } from "./process";
import type { DetachedProcess } from "./process";
import { waitForPreview } from "./preview";
import type {
  CreateOptions,
  SandboxHandle,
  SandboxPhase,
  SandboxProvider,
  SandboxSpec,
  SandboxStatus,
} from "./types";

export interface LocalPreviewProviderOptions {
  readonly rootDirectory: string;
  /**
   * Local process previews are NOT a security boundary: they run on this host
   * with a scrubbed environment and a per-tenant directory. They exist so the
   * preview pipeline can be exercised where no container runtime is available.
   * Must be enabled explicitly.
   */
  readonly allowUnsafeLocalProcess: boolean;
  readonly publicBaseUrl?: string;
  readonly bootTimeoutMs?: number;
  readonly installTimeoutMs?: number;
  readonly cloneTimeoutMs?: number;
  /** Development only: allow cloning `file://` remotes for local fixtures. */
  readonly allowFileProtocol?: boolean;
}

interface LocalSandboxRecord {
  phase: SandboxPhase;
  previewUrl?: string;
  error?: string;
  stack?: string;
  startedAt: string;
  readyAt?: string;
  readonly directory: string;
  readonly logs: string[];
  process?: DetachedProcess;
}

const MAX_LOG_LINES = 200;

export class LocalProcessPreviewProvider implements SandboxProvider {
  private readonly options: LocalPreviewProviderOptions;
  private readonly sandboxes = new Map<string, LocalSandboxRecord>();

  constructor(options: LocalPreviewProviderOptions) {
    if (!options.allowUnsafeLocalProcess) {
      throw new AppError({
        code: "forbidden",
        message:
          "Local process previews are not isolated. Enable allowUnsafeLocalProcess explicitly for development only.",
      });
    }
    this.options = options;
  }

  private statusOf(sandboxId: SandboxId, record: LocalSandboxRecord): SandboxStatus {
    return {
      sandboxId,
      phase: record.phase,
      ...(record.previewUrl === undefined ? {} : { previewUrl: record.previewUrl }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(record.stack === undefined ? {} : { stack: record.stack }),
      startedAt: record.startedAt,
      ...(record.readyAt === undefined ? {} : { readyAt: record.readyAt }),
      logs: [...record.logs],
    };
  }

  async create(
    sandboxId: SandboxId,
    spec: SandboxSpec,
    options: CreateOptions = {},
  ): Promise<SandboxHandle> {
    const directory = join(this.options.rootDirectory, spec.tenantId, String(sandboxId));
    const record: LocalSandboxRecord = {
      phase: "creating",
      startedAt: nowIso(),
      logs: [],
      directory,
    };
    this.sandboxes.set(String(sandboxId), record);

    const publish = (extra: Partial<LocalSandboxRecord> = {}): void => {
      Object.assign(record, extra);
      options.onStatus?.(this.statusOf(sandboxId, record));
    };
    const log = (line: string): void => {
      record.logs.push(line);
      if (record.logs.length > MAX_LOG_LINES) {
        record.logs.splice(0, record.logs.length - MAX_LOG_LINES);
      }
    };

    try {
      await mkdir(directory, { recursive: true });

      publish({ phase: "cloning" });
      const clone = await cloneRepository({
        repoUrl: spec.repoUrl,
        destination: directory,
        ...(spec.token === undefined ? {} : { token: spec.token }),
        ...(spec.ref === undefined ? {} : { ref: spec.ref }),
        timeoutMs: this.options.cloneTimeoutMs ?? 120_000,
        ...(this.options.allowFileProtocol === true
          ? { allowFileProtocol: true }
          : {}),
      });
      log(`cloned ${clone.redactedUrl} in ${String(clone.elapsedMs)}ms`);

      const stack = await detectStack(nodeFileReader(directory));
      if (!stack.supported) {
        throw new AppError({
          code: "sandbox_failed",
          message: stack.reason ?? "Unsupported project",
        });
      }
      publish({ stack: stack.name });

      if (stack.install.length > 0) {
        publish({ phase: "installing" });
        const install = await runProcess(
          stack.install[0] ?? "",
          stack.install.slice(1),
          {
            cwd: directory,
            timeoutMs: this.options.installTimeoutMs ?? 240_000,
          },
        );
        log(`install exit ${String(install.exitCode)}`);
        if (install.exitCode !== 0 || install.timedOut) {
          throw new AppError({
            code: "sandbox_failed",
            message: `Dependency install failed: ${install.stderr.trim().slice(0, 300)}`,
          });
        }
      }

      const port = await allocatePort();
      publish({ phase: "starting" });
      const command = withPort(stack.dev, port);
      const program = command[0];
      if (program === undefined) {
        throw new AppError({
          code: "sandbox_failed",
          message: "Detected stack has no run command",
        });
      }
      record.process = spawnDetached(program, command.slice(1), {
        cwd: directory,
        env: { HOME: directory, PORT: String(port) },
        onLog: log,
      });

      const previewUrl = `${this.options.publicBaseUrl ?? "http://127.0.0.1"}:${String(port)}`;
      const ready = await waitForPreview(previewUrl, {
        timeoutMs: this.options.bootTimeoutMs ?? 120_000,
      });
      if (!ready.ok) {
        throw new AppError({
          code: "sandbox_failed",
          message: `Preview did not become ready: ${ready.lastError ?? "no response"}`,
        });
      }
      log(`preview ready at ${previewUrl} after ${String(ready.elapsedMs)}ms`);

      publish({ phase: "ready", previewUrl, readyAt: nowIso() });

      return {
        sandboxId,
        previewUrl,
        stack: stack.name,
        status: this.statusOf(sandboxId, record),
      };
    } catch (error) {
      record.process?.stop();
      record.phase = "failed";
      record.error = error instanceof Error ? error.message : "Sandbox failed";
      options.onStatus?.(this.statusOf(sandboxId, record));
      throw error;
    }
  }

  async status(sandboxId: SandboxId): Promise<SandboxStatus | undefined> {
    const record = this.sandboxes.get(String(sandboxId));
    return record === undefined ? undefined : this.statusOf(sandboxId, record);
  }

  async logs(sandboxId: SandboxId, tail = 50): Promise<string> {
    const record = this.sandboxes.get(String(sandboxId));
    return record === undefined ? "" : record.logs.slice(-tail).join("\n");
  }

  async stop(sandboxId: SandboxId): Promise<void> {
    const record = this.sandboxes.get(String(sandboxId));
    if (record === undefined) {
      return;
    }
    record.process?.stop();
    record.phase = "stopped";
  }

  async remove(sandboxId: SandboxId): Promise<void> {
    const record = this.sandboxes.get(String(sandboxId));
    if (record === undefined) {
      return;
    }
    record.process?.stop();
    this.sandboxes.delete(String(sandboxId));
    await rm(record.directory, { recursive: true, force: true });
  }
}
