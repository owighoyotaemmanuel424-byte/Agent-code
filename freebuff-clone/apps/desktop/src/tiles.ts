import { AppError } from "@freebuff/shared";
import type { AdDecision } from "@freebuff/shared";

/**
 * Tiling geometry is pure data so the "rotation never moves the stream" rule is
 * an assertion on numbers rather than a screenshot. Every tile is
 * `[header][reserved chrome slot][stream]`; the chrome slot keeps its height
 * whether it holds an ad, a status strip or nothing at all.
 */
export const WORKSPACES = ["build", "history", "apps"] as const;
export type WorkspaceId = (typeof WORKSPACES)[number];

export const WORKSPACE_LABELS: Readonly<Record<WorkspaceId, string>> = {
  build: "Build",
  history: "History",
  apps: "Apps",
};

export const isWorkspaceId = (value: string): value is WorkspaceId =>
  (WORKSPACES as readonly string[]).includes(value);

export const MAX_TILES = 4;
export const TILE_GAP_PX = 14;
export const TILE_HEADER_PX = 46;
/** Reserved height of the chrome slot. Ads rotate inside it, never resize it. */
export const TILE_CHROME_PX = 84;
export const TILE_HEADER_TOTAL_PX = TILE_HEADER_PX + TILE_CHROME_PX;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface TileRects {
  readonly tile: Rect;
  readonly header: Rect;
  readonly chrome: Rect;
  readonly stream: Rect;
}

export interface TileAd {
  readonly decision: AdDecision;
  readonly html: string;
}

export interface TileView {
  readonly id: string;
  readonly workspace: WorkspaceId;
  readonly title: string;
  readonly status: "idle" | "running" | "deployed" | "failed";
  readonly prompt: string;
  readonly lines: readonly {
    readonly step: string;
    readonly status: "ok" | "failed";
    readonly detail: string;
  }[];
  readonly appUrl?: string;
  readonly ad?: TileAd;
  /** Plan the viewer is on; the shell refuses to render ads for paid accounts. */
  readonly plan: "free" | "paid";
}

const gridTiles = (count: number, viewport: Viewport): readonly Rect[] => {
  const { width, height } = viewport;
  const gap = TILE_GAP_PX;
  const half = (total: number): number => Math.floor((total - gap) / 2);
  const rest = (total: number, first: number): number => total - first - gap;

  switch (count) {
    case 0:
      return [];
    case 1:
      return [{ x: 0, y: 0, width, height }];
    case 2: {
      const column = half(width);
      return [
        { x: 0, y: 0, width: column, height },
        { x: column + gap, y: 0, width: rest(width, column), height },
      ];
    }
    case 3: {
      const column = half(width);
      const row = half(height);
      return [
        { x: 0, y: 0, width: column, height },
        { x: column + gap, y: 0, width: rest(width, column), height: row },
        {
          x: column + gap,
          y: row + gap,
          width: rest(width, column),
          height: rest(height, row),
        },
      ];
    }
    default: {
      const column = half(width);
      const row = half(height);
      const rightWidth = rest(width, column);
      const bottomHeight = rest(height, row);
      return [
        { x: 0, y: 0, width: column, height: row },
        { x: column + gap, y: 0, width: rightWidth, height: row },
        { x: 0, y: row + gap, width: column, height: bottomHeight },
        {
          x: column + gap,
          y: row + gap,
          width: rightWidth,
          height: bottomHeight,
        },
      ];
    }
  }
};

/** Tile rects in reading order; tiles past the maximum are refused, not drawn. */
export const layoutWorkspace = (
  count: number,
  viewport: Viewport,
): readonly TileRects[] => {
  if (count > MAX_TILES) {
    throw new AppError({
      code: "validation_failed",
      message: `A workspace tiles at most ${String(MAX_TILES)} sessions`,
    });
  }
  return gridTiles(count, viewport).map((tile) => {
    const header: Rect = {
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: TILE_HEADER_PX,
    };
    const chrome: Rect = {
      x: tile.x,
      y: tile.y + TILE_HEADER_PX,
      width: tile.width,
      height: TILE_CHROME_PX,
    };
    const stream: Rect = {
      x: tile.x,
      y: tile.y + TILE_HEADER_TOTAL_PX,
      width: tile.width,
      height: Math.max(0, tile.height - TILE_HEADER_TOTAL_PX),
    };
    return { tile, header, chrome, stream };
  });
};

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/**
 * The ad rules for this surface, enforced at render time rather than reviewed:
 * one sponsored slot per workspace, only on the free plan, inside chrome, and
 * never overlapping the stream region of any tile.
 */
export const validateWorkspaceChrome = (
  tiles: readonly TileView[],
  rects: readonly TileRects[],
): void => {
  if (tiles.length !== rects.length) {
    throw new AppError({
      code: "validation_failed",
      message: "Layout does not match the workspace tiles",
    });
  }
  if (tiles.length > MAX_TILES) {
    throw new AppError({
      code: "validation_failed",
      message: `A workspace tiles at most ${String(MAX_TILES)} sessions`,
    });
  }
  const ads = tiles.filter((tile) => tile.ad !== undefined);
  if (ads.length > 1) {
    throw new AppError({
      code: "validation_failed",
      message: "One sponsored slot per workspace",
    });
  }
  tiles.forEach((tile, index) => {
    const rectsForTile = rects[index];
    if (rectsForTile === undefined) return;
    if (rectsForTile.stream.y < rectsForTile.chrome.y + rectsForTile.chrome.height) {
      throw new AppError({
        code: "validation_failed",
        message: "The stream must start below the reserved chrome slot",
      });
    }
    if (rectsForTile.chrome.height !== TILE_CHROME_PX) {
      throw new AppError({
        code: "validation_failed",
        message: "The chrome slot changed its reserved height",
      });
    }
    if (tile.ad === undefined) return;
    if (tile.plan !== "free") {
      throw new AppError({
        code: "validation_failed",
        message: "Paid accounts must not render sponsored slots",
      });
    }
    if (tile.ad.decision.ad.label !== "Sponsored") {
      throw new AppError({
        code: "validation_failed",
        message: "Sponsored inventory must carry the Sponsored label",
      });
    }
    if (!tile.ad.html.includes('class="sponsored-label"')) {
      throw new AppError({
        code: "validation_failed",
        message: "Sponsored markup must render the literal label",
      });
    }
    if (!tile.ad.html.includes(tile.ad.decision.ad.label)) {
      throw new AppError({
        code: "validation_failed",
        message: "Sponsored markup must render the literal label",
      });
    }
    const layer = rectsForTile.chrome;
    const stream = rectsForTile.stream;
    if (overlaps(layer, stream)) {
      throw new AppError({
        code: "validation_failed",
        message: "A sponsored slot must never overlap a stream region",
      });
    }
  });
};

/** Rotation swaps the ad inside a tile and touches nothing else. */
export const rotateTileAd = (tile: TileView, next: TileAd): TileView => ({
  ...tile,
  ad: next,
});
