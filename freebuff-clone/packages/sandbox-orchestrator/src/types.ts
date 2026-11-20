import type { SandboxId } from "@freebuff/shared";

/** Resource and network policy for one tenant sandbox. */
export interface ResourceLimits {
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly diskMb: number;
  readonly pidsLimit: number;
  readonly wallClockMs: number;
}

export const DEFAULT_LIMITS: ResourceLimits = {
  cpuCores: 2,
  memoryMb: 2048,
  diskMb: 4096,
  pidsLimit: 512,
  wallClockMs: 20 * 60 * 1000,
};

export interface EgressPolicy {
  readonly mode: "none" | "allowlist";
  readonly allowHosts: readonly string[];
}

export const NO_EGRESS: EgressPolicy = { mode: "none", allowHosts: [] };

/** Registry and git hosts a sandbox needs during install. */
export const INSTALL_EGRESS: EgressPolicy = {
  mode: "allowlist",
  allowHosts: [
    "github.com",
    "codeload.github.com",
    "registry.npmjs.org",
    "registry.yarnpkg.com",
    "pypi.org",
    "files.pythonhosted.org",
  ],
};

export interface SandboxSpec {
  readonly repoUrl: string;
  readonly ref?: string;
  readonly tenantId: string;
  readonly limits?: ResourceLimits;
  readonly egress?: EgressPolicy;
  readonly ttlMs?: number;
  readonly token?: string;
}

export type SandboxPhase =
  | "creating"
  | "cloning"
  | "installing"
  | "starting"
  | "ready"
  | "failed"
  | "stopped";

export interface SandboxStatus {
  readonly sandboxId: SandboxId;
  readonly phase: SandboxPhase;
  readonly previewUrl?: string;
  readonly error?: string;
  readonly stack?: string;
  readonly startedAt: string;
  readonly readyAt?: string;
  readonly logs: readonly string[];
}

export interface SandboxHandle {
  readonly sandboxId: SandboxId;
  readonly previewUrl: string;
  readonly stack: string;
  readonly status: SandboxStatus;
}

export interface CreateOptions {
  readonly onStatus?: (status: SandboxStatus) => void;
  readonly signal?: AbortSignal;
}

/** Every sandbox backend implements this, Docker locally and microVM in prod. */
export interface SandboxProvider {
  create(
    sandboxId: SandboxId,
    spec: SandboxSpec,
    options?: CreateOptions,
  ): Promise<SandboxHandle>;
  status(sandboxId: SandboxId): Promise<SandboxStatus | undefined>;
  logs(sandboxId: SandboxId, tail?: number): Promise<string>;
  stop(sandboxId: SandboxId): Promise<void>;
  remove(sandboxId: SandboxId): Promise<void>;
}
