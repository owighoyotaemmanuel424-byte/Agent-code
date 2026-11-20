import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError, nowIso } from "@freebuff/shared";
import type { SandboxId } from "@freebuff/shared";
import { detectStack, withPort } from "./detect";
import type { StackFileReader } from "./detect";
import type { ContainerRuntime, ExecResult } from "./docker-runtime";
import { DockerCliRuntime } from "./docker-runtime";
import { buildCloneUrl } from "./git";
import { waitForPreview } from "./preview";
import { DEFAULT_LIMITS, INSTALL_EGRESS } from "./types";
import type {
  CreateOptions,
  SandboxHandle,
  SandboxPhase,
  SandboxProvider,
  SandboxSpec,
  SandboxStatus,
} from "./types";

export interface DockerProviderOptions {
  readonly workspaceRoot: string;
  readonly runtime?: ContainerRuntime;
  readonly image?: string;
  /** Container port the preview server is forced onto. */
  readonly previewPort?: number;
  readonly bootTimeoutMs?: number;
  readonly installTimeoutMs?: number;
}

const DEFAULT_PREVIEW_PORT = 3000;
const CONTAINER_WORKDIR = "/workspace";
const REPO_DIR = "/workspace/repo";
const MAX_LOG_LINES = 200;

interface DockerSandboxRecord {
  phase: SandboxPhase;
  previewUrl?: string;
  error?: string;
  stack?: string;
  startedAt: string;
  readyAt?: string;
  containerId?: string;
  network: string;
  directory: string;
  readonly logs: string[];
}

const quoteShell = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

const containerFileReader = (
  runtime: ContainerRuntime,
  containerId: string,
): StackFileReader => ({
  read: async (path) => {
    const result = await runtime.execIn(containerId, ["cat", `${REPO_DIR}/${path}`]);
    return result.exitCode === 0 ? result.stdout : undefined;
  },
  exists: async (path) => {
    const result = await runtime.execIn(containerId, [
      "test",
      "-e",
      `${REPO_DIR}/${path}`,
    ]);
    return result.exitCode === 0;
  },
});

const assertOk = (result: ExecResult, message: string): void => {
  if (result.exitCode !== 0) {
    throw new AppError({
      code: "sandbox_failed",
      message: `${message}: ${result.stderr.trim().slice(0, 300)}`,
    });
  }
};

/**
 * Container-per-tenant sandbox provider. Production swaps the runtime for a
 * microVM implementation; the isolation contract and lifecycle are identical.
 */
export class DockerSandboxProvider implements SandboxProvider {
  private readonly runtime: ContainerRuntime;
  private readonly options: DockerProviderOptions;
  private readonly records = new Map<string, DockerSandboxRecord>();

  constructor(options: DockerProviderOptions) {
    this.options = options;
    this.runtime = options.runtime ?? new DockerCliRuntime();
  }

  private statusOf(
    sandboxId: SandboxId,
    record: DockerSandboxRecord,
  ): SandboxStatus {
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
    const runtime = this.runtime;
    const image = this.options.image ?? "freebuff/sandbox-base:latest";
    const previewPort = this.options.previewPort ?? DEFAULT_PREVIEW_PORT;
    const limits = spec.limits ?? DEFAULT_LIMITS;
    const egress = spec.egress ?? INSTALL_EGRESS;
    const network = `fb-${String(sandboxId).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 20)}`;
    const directory = join(this.options.workspaceRoot, spec.tenantId, String(sandboxId));

    const record: DockerSandboxRecord = {
      phase: "creating",
      startedAt: nowIso(),
      logs: [],
      network,
      directory,
    };
    this.records.set(String(sandboxId), record);

    const publish = (extra: Partial<DockerSandboxRecord> = {}): void => {
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
      await runtime.ensureNetwork(network, egress.mode === "none");

      const containerId = await runtime.runContainer({
        name: `freebuff-${String(sandboxId).slice(0, 12)}`,
        image,
        env: { HOME: "/home/sandbox", CI: "1", PORT: String(previewPort) },
        network,
        workdir: CONTAINER_WORKDIR,
        volumes: [`${directory}:${CONTAINER_WORKDIR}:rw`],
        memoryMb: limits.memoryMb,
        cpus: limits.cpuCores,
        pidsLimit: limits.pidsLimit,
        publishContainerPort: previewPort,
        command: ["sleep", "infinity"],
        labels: { "freebuff.sandbox": String(sandboxId), "freebuff.tenant": spec.tenantId },
      });
      publish({ containerId });
      log(`container ${containerId.slice(0, 12)} started on network ${network}`);

      publish({ phase: "cloning" });
      const cloneUrl = buildCloneUrl(spec.repoUrl, spec.token);
      const clone = await runtime.execIn(
        containerId,
        [
          "git",
          "clone",
          "--depth",
          "1",
          ...(spec.ref === undefined ? [] : ["--branch", spec.ref]),
          cloneUrl,
          REPO_DIR,
        ],
        { timeoutMs: 120_000 },
      );
      // Never echo the authenticated URL.
      assertOk(clone, "Clone failed");
      log("repository cloned");

      const stack = await detectStack(containerFileReader(runtime, containerId));
      if (!stack.supported) {
        throw new AppError({
          code: "sandbox_failed",
          message: stack.reason ?? "Unsupported project",
        });
      }
      publish({ stack: stack.name });

      if (stack.install.length > 0) {
        publish({ phase: "installing" });
        const install = await runtime.execIn(
          containerId,
          stack.install,
          { timeoutMs: this.options.installTimeoutMs ?? 240_000, cwd: REPO_DIR },
        );
        assertOk(install, "Dependency install failed");
        log("dependencies installed");
      }

      publish({ phase: "starting" });
      const command = withPort(stack.dev, previewPort);
      const line = `cd ${REPO_DIR} && nohup ${command.map(quoteShell).join(" ")} > /tmp/preview.log 2>&1 &`;
      const started = await runtime.execIn(
        containerId,
        ["sh", "-lc", line],
        { timeoutMs: 30_000 },
      );
      assertOk(started, "Could not start the preview server");

      const hostPort = await runtime.hostPort(containerId, previewPort);
      if (hostPort === undefined) {
        throw new AppError({
          code: "sandbox_failed",
          message: "Preview port was not published",
        });
      }
      const previewUrl = `http://127.0.0.1:${String(hostPort)}`;
      const ready = await waitForPreview(previewUrl, {
        timeoutMs: this.options.bootTimeoutMs ?? 120_000,
      });
      if (!ready.ok) {
        const tail = await runtime.containerLogs(containerId, 30).catch(() => "");
        log(tail);
        throw new AppError({
          code: "sandbox_failed",
          message: `Preview did not become ready: ${ready.lastError ?? "no response"}`,
        });
      }
      log(`preview ready after ${String(ready.elapsedMs)}ms`);

      publish({ phase: "ready", previewUrl, readyAt: nowIso() });
      return {
        sandboxId,
        previewUrl,
        stack: stack.name,
        status: this.statusOf(sandboxId, record),
      };
    } catch (error) {
      if (record.containerId !== undefined) {
        await runtime.removeContainer(record.containerId).catch(() => undefined);
      }
      await runtime.removeNetwork(network).catch(() => undefined);
      record.phase = "failed";
      record.error = error instanceof Error ? error.message : "Sandbox failed";
      options.onStatus?.(this.statusOf(sandboxId, record));
      throw error;
    }
  }

  async status(sandboxId: SandboxId): Promise<SandboxStatus | undefined> {
    const record = this.records.get(String(sandboxId));
    return record === undefined ? undefined : this.statusOf(sandboxId, record);
  }

  async logs(sandboxId: SandboxId, tail = 50): Promise<string> {
    const record = this.records.get(String(sandboxId));
    if (record === undefined) {
      return "";
    }
    if (record.containerId === undefined) {
      return record.logs.slice(-tail).join("\n");
    }
    return this.runtime.containerLogs(record.containerId, tail).catch(() =>
      record.logs.slice(-tail).join("\n"),
    );
  }

  async stop(sandboxId: SandboxId): Promise<void> {
    const record = this.records.get(String(sandboxId));
    if (record === undefined) {
      return;
    }
    if (record.containerId !== undefined) {
      await this.runtime.stopContainer(record.containerId).catch(() => undefined);
    }
    record.phase = "stopped";
  }

  async remove(sandboxId: SandboxId): Promise<void> {
    const record = this.records.get(String(sandboxId));
    if (record === undefined) {
      return;
    }
    if (record.containerId !== undefined) {
      await this.runtime.removeContainer(record.containerId).catch(() => undefined);
    }
    await this.runtime.removeNetwork(record.network).catch(() => undefined);
    this.records.delete(String(sandboxId));
    await rm(record.directory, { recursive: true, force: true });
  }
}
