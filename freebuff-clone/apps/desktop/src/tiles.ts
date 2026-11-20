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

/** Split ratios of a workspace: share of the first column and first row. */
export interface TileRatios {
  readonly column: number;
  readonly row: number;
}

export const DEFAULT_RATIOS: TileRatios = { column: 0.5, row: 0.5 };
/** A splitter can never collapse a tile away or hide it behind another. */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
export const RATIO_STEP = 0.04;

export const clampRatio = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_RATIOS.column;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
};

export const normalizeRatios = (
  ratios?: Partial<TileRatios> | undefined,
): TileRatios => ({
  column: clampRatio(ratios?.column ?? DEFAULT_RATIOS.column),
  row: clampRatio(ratios?.row ?? DEFAULT_RATIOS.row),
});

/** Splits the space left after the gutters, so a drag never changes the gap. */
const share = (total: number, ratio: number, gap: number): number =>
  Math.round((total - gap) * ratio);

const gridTiles = (
  count: number,
  viewport: Viewport,
  ratios: TileRatios,
): readonly Rect[] => {
  const { width, height } = viewport;
  const gap = TILE_GAP_PX;

  switch (count) {
    case 0:
      return [];
    case 1:
      return [{ x: 0, y: 0, width, height }];
    case 2: {
      const column = share(width, ratios.column, gap);
      return [
        { x: 0, y: 0, width: column, height },
        { x: column + gap, y: 0, width: width - column - gap, height },
      ];
    }
    case 3: {
      const column = share(width, ratios.column, gap);
      const row = share(height, ratios.row, gap);
      const rightX = column + gap;
      const rightWidth = width - column - gap;
      return [
        { x: 0, y: 0, width: column, height },
        { x: rightX, y: 0, width: rightWidth, height: row },
        { x: rightX, y: row + gap, width: rightWidth, height: height - row - gap },
      ];
    }
    default: {
      const column = share(width, ratios.column, gap);
      const row = share(height, ratios.row, gap);
      const rightX = column + gap;
      const rightWidth = width - column - gap;
      const bottomY = row + gap;
      const bottomHeight = height - row - gap;
      return [
        { x: 0, y: 0, width: column, height: row },
        { x: rightX, y: 0, width: rightWidth, height: row },
        { x: 0, y: bottomY, width: column, height: bottomHeight },
        { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight },
      ];
    }
  }
};

/** Tile rects in reading order; tiles past the maximum are refused, not drawn. */
export const layoutWorkspace = (
  count: number,
  viewport: Viewport,
  ratios?: Partial<TileRatios> | undefined,
): readonly TileRects[] => {
  if (count > MAX_TILES) {
    throw new AppError({
      code: "validation_failed",
      message: `A workspace tiles at most ${String(MAX_TILES)} sessions`,
    });
  }
  return gridTiles(count, viewport, normalizeRatios(ratios)).map((tile) => {
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

export interface SplitHandle {
  readonly axis: "column" | "row";
  readonly orientation: "vertical" | "horizontal";
  /** Current split as a fraction of the workspace, for ARIA. */
  readonly value: number;
  readonly rect: Rect;
}

const HANDLE_PX = 10;

/**
 * Drag targets for the same gutters the layout uses. A column splitter is a
 * vertical bar between columns; the row splitter for three tiles spans only the
 * stacked column, because that is the only place a row split exists.
 */
export const splitHandles = (
  count: number,
  viewport: Viewport,
  ratios?: Partial<TileRatios> | undefined,
): readonly SplitHandle[] => {
  const normalized = normalizeRatios(ratios);
  const tiles = layoutWorkspace(count, viewport, normalized);
  const handles: SplitHandle[] = [];
  const columnEdge = tiles[0] === undefined ? 0 : tiles[0].tile.x + tiles[0].tile.width;
  if (count >= 2) {
    handles.push({
      axis: "column",
      orientation: "vertical",
      value: normalized.column,
      rect: {
        x: columnEdge + Math.floor(TILE_GAP_PX / 2) - Math.floor(HANDLE_PX / 2),
        y: 0,
        width: HANDLE_PX,
        height: viewport.height,
      },
    });
  }
  if (count === 3 || count === 4) {
    const anchor = count === 3 ? tiles[1] : tiles[0];
    const rowEdge = anchor === undefined ? 0 : anchor.tile.y + anchor.tile.height;
    const x = count === 3 && anchor !== undefined ? anchor.tile.x : 0;
    handles.push({
      axis: "row",
      orientation: "horizontal",
      value: normalized.row,
      rect: {
        x,
        y: rowEdge + Math.floor(TILE_GAP_PX / 2) - Math.floor(HANDLE_PX / 2),
        width: count === 3 && anchor !== undefined ? anchor.tile.width : viewport.width,
        height: HANDLE_PX,
      },
    });
  }
  return handles;
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
