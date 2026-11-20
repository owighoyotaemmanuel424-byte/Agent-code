import { AppError } from "@freebuff/shared";
import { runProcess } from "./process";

/** Docker CLI adapter. Isolation flags are built here and unit tested. */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CommandExecutor {
  exec(
    command: string,
    args: readonly string[],
    options: { readonly timeoutMs: number },
  ): Promise<ExecResult>;
}

export class NodeCommandExecutor implements CommandExecutor {
  async exec(
    command: string,
    args: readonly string[],
    options: { readonly timeoutMs: number },
  ): Promise<ExecResult> {
    const result = await runProcess(command, args, { timeoutMs: options.timeoutMs });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }
}

export interface ContainerRunSpec {
  readonly name: string;
  readonly image: string;
  readonly env: Readonly<Record<string, string>>;
  readonly network: string;
  readonly workdir: string;
  readonly volumes: readonly string[];
  readonly memoryMb: number;
  readonly cpus: number;
  readonly pidsLimit: number;
  readonly publishContainerPort?: number;
  readonly command?: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
}

/**
 * Builds `docker run` arguments with the hostile-input posture: read-only root,
 * no capabilities, no privilege escalation, bounded CPU/memory/PIDs, a dedicated
 * network and a per-tenant bind mount.
 */
export const buildRunArgs = (spec: ContainerRunSpec): string[] => [
  "run",
  "--detach",
  "--name",
  spec.name,
  "--read-only",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,size=256m",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--memory",
  `${String(spec.memoryMb)}m`,
  "--cpus",
  String(spec.cpus),
  "--pids-limit",
  String(spec.pidsLimit),
  "--network",
  spec.network,
  "--workdir",
  spec.workdir,
  ...spec.volumes.flatMap((volume) => ["--volume", volume]),
  ...Object.entries(spec.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
  ...Object.entries(spec.labels ?? {}).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]),
  ...(spec.publishContainerPort === undefined
    ? []
    : ["--publish", `127.0.0.1::${String(spec.publishContainerPort)}`]),
  spec.image,
  ...(spec.command ?? []),
];

export interface ContainerRuntime {
  ensureNetwork(name: string, internal: boolean): Promise<void>;
  removeNetwork(name: string): Promise<void>;
  runContainer(spec: ContainerRunSpec): Promise<string>;
  execIn(
    containerId: string,
    argv: readonly string[],
    options?: { readonly timeoutMs?: number; readonly cwd?: string },
  ): Promise<ExecResult>;
  hostPort(containerId: string, containerPort: number): Promise<number | undefined>;
  containerLogs(containerId: string, tail: number): Promise<string>;
  isRunning(containerId: string): Promise<boolean>;
  stopContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
}

export class DockerCliRuntime implements ContainerRuntime {
  private readonly executor: CommandExecutor;
  private readonly docker: string;

  constructor(executor: CommandExecutor = new NodeCommandExecutor(), docker = "docker") {
    this.executor = executor;
    this.docker = docker;
  }

  private async docker$(
    args: readonly string[],
    timeoutMs = 60_000,
  ): Promise<ExecResult> {
    return this.executor.exec(this.docker, args, { timeoutMs });
  }

  async ensureNetwork(name: string, internal: boolean): Promise<void> {
    const result = await this.docker$([
      "network",
      "create",
      ...(internal ? ["--internal"] : []),
      name,
    ]);
    if (result.exitCode !== 0 && !result.stderr.includes("already exists")) {
      throw new AppError({
        code: "sandbox_failed",
        message: `Could not create sandbox network: ${result.stderr.trim().slice(0, 200)}`,
      });
    }
  }

  async removeNetwork(name: string): Promise<void> {
    await this.docker$(["network", "rm", name]);
  }

  async runContainer(spec: ContainerRunSpec): Promise<string> {
    const result = await this.docker$(buildRunArgs(spec), 120_000);
    const containerId = result.stdout.trim();
    if (result.exitCode !== 0 || containerId.length === 0) {
      throw new AppError({
        code: "sandbox_failed",
        message: `Could not start sandbox container: ${result.stderr.trim().slice(0, 300)}`,
      });
    }
    return containerId;
  }

  async execIn(
    containerId: string,
    argv: readonly string[],
    options: { readonly timeoutMs?: number; readonly cwd?: string } = {},
  ): Promise<ExecResult> {
    return this.docker$(
      [
        "exec",
        ...(options.cwd === undefined ? [] : ["--workdir", options.cwd]),
        containerId,
        ...argv,
      ],
      options.timeoutMs ?? 120_000,
    );
  }

  async hostPort(
    containerId: string,
    containerPort: number,
  ): Promise<number | undefined> {
    const result = await this.docker$([
      "port",
      containerId,
      `${String(containerPort)}/tcp`,
    ]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const match = /:(\d+)\s*$/.exec(result.stdout.trim());
    return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
  }

  async containerLogs(containerId: string, tail: number): Promise<string> {
    const result = await this.docker$([
      "logs",
      "--tail",
      String(tail),
      containerId,
    ]);
    return `${result.stdout}${result.stderr}`;
  }

  async isRunning(containerId: string): Promise<boolean> {
    const result = await this.docker$([
      "inspect",
      "--format",
      "{{.State.Running}}",
      containerId,
    ]);
    return result.exitCode === 0 && result.stdout.trim() === "true";
  }

  async stopContainer(containerId: string): Promise<void> {
    await this.docker$(["stop", "-t", "2", containerId]);
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.docker$(["rm", "-f", containerId]);
  }
}
