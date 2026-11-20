import { AppError, newId, nowIso, sandboxIdSchema } from "@freebuff/shared";
import type { SandboxId } from "@freebuff/shared";
import type { CreateOptions, SandboxHandle, SandboxProvider, SandboxSpec, SandboxStatus } from "./types";

export interface SandboxManagerOptions {
  readonly maxSandboxesPerTenant?: number;
  readonly now?: () => Date;
}

interface ManagedSandbox {
  readonly sandboxId: SandboxId;
  readonly tenantId: string;
  readonly createdAt: string;
  readonly ttlMs: number;
  stopped: boolean;
}

/**
 * Tenant-scoped lifecycle over a provider: quotas, ownership checks, sharing and
 * TTL reaping. The manager never executes repository code itself.
 */
export class SandboxManager {
  private readonly provider: SandboxProvider;
  private readonly maxPerTenant: number;
  private readonly now: () => Date;
  private readonly sandboxes = new Map<string, ManagedSandbox>();

  constructor(provider: SandboxProvider, options: SandboxManagerOptions = {}) {
    this.provider = provider;
    this.maxPerTenant = options.maxSandboxesPerTenant ?? 3;
    this.now = options.now ?? (() => new Date());
  }

  async create(
    tenantId: string,
    spec: Omit<SandboxSpec, "tenantId">,
    options: CreateOptions = {},
  ): Promise<SandboxHandle> {
    const active = [...this.sandboxes.values()].filter(
      (sandbox) => sandbox.tenantId === tenantId && !sandbox.stopped,
    );
    if (active.length >= this.maxPerTenant) {
      throw new AppError({
        code: "conflict",
        message: `Sandbox limit reached (${String(this.maxPerTenant)} per account)`,
      });
    }

    const sandboxId = sandboxIdSchema.parse(newId());
    const managed: ManagedSandbox = {
      sandboxId,
      tenantId,
      createdAt: nowIso(),
      ttlMs: spec.ttlMs ?? 60 * 60 * 1000,
      stopped: false,
    };
    this.sandboxes.set(String(sandboxId), managed);

    try {
      return await this.provider.create(
        sandboxId,
        { ...spec, tenantId },
        options,
      );
    } catch (error) {
      this.sandboxes.delete(String(sandboxId));
      throw error;
    }
  }

  /** Ownership is enforced here, not by the caller. */
  private owned(sandboxId: string, tenantId: string | undefined): ManagedSandbox {
    const managed = this.sandboxes.get(sandboxId);
    if (managed === undefined) {
      throw new AppError({ code: "not_found", message: "Unknown sandbox" });
    }
    if (tenantId !== undefined && managed.tenantId !== tenantId) {
      throw new AppError({ code: "forbidden", message: "Not your sandbox" });
    }
    return managed;
  }

  async status(
    sandboxId: string,
    tenantId?: string,
  ): Promise<SandboxStatus | undefined> {
    const managed = this.owned(sandboxId, tenantId);
    return this.provider.status(managed.sandboxId);
  }

  async logs(sandboxId: string, tenantId?: string, tail = 50): Promise<string> {
    const managed = this.owned(sandboxId, tenantId);
    return this.provider.logs(managed.sandboxId, tail);
  }

  /** Shareable preview link for a ready sandbox. */
  async shareLink(sandboxId: string, tenantId?: string): Promise<string> {
    const managed = this.owned(sandboxId, tenantId);
    const status = await this.provider.status(managed.sandboxId);
    if (status?.previewUrl === undefined) {
      throw new AppError({
        code: "not_found",
        message: "Preview is not ready yet",
      });
    }
    return status.previewUrl;
  }

  async stop(sandboxId: string, tenantId?: string): Promise<void> {
    const managed = this.owned(sandboxId, tenantId);
    await this.provider.stop(managed.sandboxId);
    managed.stopped = true;
  }

  async remove(sandboxId: string, tenantId?: string): Promise<void> {
    const managed = this.owned(sandboxId, tenantId);
    await this.provider.remove(managed.sandboxId);
    this.sandboxes.delete(sandboxId);
  }

  async list(tenantId?: string): Promise<SandboxStatus[]> {
    const managed = [...this.sandboxes.values()].filter(
      (sandbox) => tenantId === undefined || sandbox.tenantId === tenantId,
    );
    const statuses = await Promise.all(
      managed.map((sandbox) => this.provider.status(sandbox.sandboxId)),
    );
    return statuses.filter((status): status is SandboxStatus => status !== undefined);
  }

  tenantOf(sandboxId: string): string | undefined {
    return this.sandboxes.get(sandboxId)?.tenantId;
  }

  /** Stops sandboxes that have exceeded their TTL. */
  async reapExpired(): Promise<readonly SandboxId[]> {
    const now = this.now().getTime();
    const expired: SandboxId[] = [];
    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.stopped) {
        continue;
      }
      if (now - Date.parse(sandbox.createdAt) >= sandbox.ttlMs) {
        await this.provider.stop(sandbox.sandboxId).catch(() => undefined);
        sandbox.stopped = true;
        expired.push(sandbox.sandboxId);
      }
    }
    return expired;
  }
}
