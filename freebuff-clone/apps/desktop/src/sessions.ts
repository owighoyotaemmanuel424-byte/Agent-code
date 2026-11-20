import { AppError } from "@freebuff/shared";
import {
  MAX_TILES,
  normalizeRatios,
  type TileRatios,
  type WorkspaceId,
} from "./tiles";

export interface StreamLine {
  readonly step: string;
  readonly status: "ok" | "failed";
  readonly detail: string;
}

export interface TileSession {
  readonly id: string;
  readonly workspace: WorkspaceId;
  readonly title: string;
  readonly prompt: string;
  readonly status: "idle" | "running" | "deployed" | "failed";
  readonly lines: readonly StreamLine[];
  readonly appUrl?: string;
}

const BUSY = new Set<TileSession["status"]>(["running"]);

/**
 * Layout state of the shell window: which sessions exist and what each one has
 * streamed. This is deliberately local and in-memory — it is window state, not
 * entitlement state, and every quota, plan and ad decision still comes from the
 * platform. Restarting the shell starts with an empty desktop.
 */
export class TileStore {
  private readonly tiles = new Map<string, TileSession>();
  private nextId = 1;

  create(input: {
    readonly workspace: WorkspaceId;
    readonly title: string;
    readonly prompt?: string;
  }): TileSession {
    const existing = this.list(input.workspace).length;
    if (existing >= MAX_TILES) {
      throw new AppError({
        code: "conflict",
        message: `This workspace already tiles ${String(MAX_TILES)} sessions`,
      });
    }
    const id = `tile-${String(this.nextId)}`;
    this.nextId += 1;
    const session: TileSession = {
      id,
      workspace: input.workspace,
      title: input.title,
      prompt: input.prompt ?? "",
      status: "idle",
      lines: [],
    };
    this.tiles.set(id, session);
    return session;
  }

  get(id: string): TileSession {
    const session = this.tiles.get(id);
    if (session === undefined) {
      throw new AppError({ code: "not_found", message: "Unknown tile" });
    }
    return session;
  }

  list(workspace: WorkspaceId): readonly TileSession[] {
    return [...this.tiles.values()].filter((tile) => tile.workspace === workspace);
  }

  /** Finished sessions keep their stream; they are what the History workspace shows. */
  finished(): readonly TileSession[] {
    return [...this.tiles.values()].filter(
      (tile) => tile.workspace === "build" && !BUSY.has(tile.status) && tile.lines.length > 0,
    );
  }

  begin(id: string, prompt: string): TileSession {
    const session = this.get(id);
    if (BUSY.has(session.status)) {
      throw new AppError({ code: "conflict", message: "This tile is already building" });
    }
    const next: TileSession = {
      ...session,
      prompt,
      status: "running",
      lines: [],
      appUrl: undefined,
    };
    this.tiles.set(id, next);
    return next;
  }

  append(id: string, line: StreamLine): TileSession {
    const session = this.get(id);
    const lines = [...session.lines, line];
    const next: TileSession = { ...session, lines };
    this.tiles.set(id, next);
    return next;
  }

  finish(
    id: string,
    input: {
      readonly status: "deployed" | "failed";
      readonly appUrl?: string;
    },
  ): TileSession {
    const session = this.get(id);
    const next: TileSession = { ...session, status: input.status };
    const settled: TileSession =
      input.appUrl === undefined ? { ...next, appUrl: undefined } : { ...next, appUrl: input.appUrl };
    this.tiles.set(id, settled);
    return settled;
  }

  close(id: string): void {
    this.get(id);
    this.tiles.delete(id);
  }

  get size(): number {
    return this.tiles.size;
  }
}

/**
 * Split ratios per workspace. Like the tiles themselves this is window state:
 * the shell remembers a drag for its lifetime, the platform never sees it.
 */
export class LayoutStore {
  private readonly ratios = new Map<WorkspaceId, TileRatios>();

  get(workspace: WorkspaceId): TileRatios {
    return normalizeRatios(this.ratios.get(workspace));
  }

  set(workspace: WorkspaceId, next: Partial<TileRatios>): TileRatios {
    const merged = normalizeRatios({ ...this.get(workspace), ...next });
    this.ratios.set(workspace, merged);
    return merged;
  }
}
