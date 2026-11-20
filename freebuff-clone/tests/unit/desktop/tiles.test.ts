import { describe, expect, it } from "vitest";
import { defaultAdInventory, sponsoredAdHtml } from "@freebuff/ads";
import type { Ad, AdDecision } from "@freebuff/shared";
import {
  clampRatio,
  DEFAULT_RATIOS,
  layoutWorkspace,
  MAX_RATIO,
  MAX_TILES,
  MIN_RATIO,
  normalizeRatios,
  splitHandles,
  rotateTileAd,
  TILE_CHROME_PX,
  TILE_HEADER_PX,
  TILE_HEADER_TOTAL_PX,
  validateWorkspaceChrome,
  type Rect,
  type TileAd,
  type TileView,
} from "../../../apps/desktop/src/tiles";
import { parseStreamEvent, splitLines, streamEventToLine } from "../../../apps/desktop/src/stream";
import { TileStore } from "../../../apps/desktop/src/sessions";

const VIEWPORT = { width: 1440, height: 820 };

const tiles = (count: number, plan: "free" | "paid" = "free"): readonly TileView[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `tile-${String(index + 1)}`,
    workspace: "build" as const,
    title: `Session ${String(index + 1)}`,
    status: "idle" as const,
    prompt: "",
    lines: [],
    plan,
  }));

const decisionFor = (ad: Ad): AdDecision => ({ slot: "desktop.sidebar", ad, rationale: "fallback" });

const adFor = (index: number): TileAd => {
  const ad = defaultAdInventory.ads[index % defaultAdInventory.ads.length] as Ad;
  return { decision: decisionFor(ad), html: sponsoredAdHtml(ad) };
};

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("desktop tiling", () => {
  it("tiles one to four sessions without gaps or overlap", () => {
    for (let count = 1; count <= MAX_TILES; count += 1) {
      const rects = layoutWorkspace(count, VIEWPORT);
      expect(rects).toHaveLength(count);
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          const left = rects[a]?.tile;
          const right = rects[b]?.tile;
          if (left === undefined || right === undefined) continue;
          expect(overlaps(left, right)).toBe(false);
        }
      }
      const right = Math.max(...rects.map((rect) => rect.tile.x + rect.tile.width));
      const bottom = Math.max(...rects.map((rect) => rect.tile.y + rect.tile.height));
      expect(right).toBe(VIEWPORT.width);
      expect(bottom).toBe(VIEWPORT.height);
      expect(rects[0]?.tile).toMatchObject({ x: 0, y: 0 });
    }
  });

  it("reserves the chrome slot and starts every stream below it", () => {
    for (const count of [1, 2, 3, 4]) {
      const rects = layoutWorkspace(count, VIEWPORT);
      for (const rect of rects) {
        expect(rect.header.height).toBe(TILE_HEADER_PX);
        expect(rect.chrome.height).toBe(TILE_CHROME_PX);
        expect(rect.stream.y).toBe(rect.chrome.y + rect.chrome.height);
        expect(rect.stream.y + rect.stream.height).toBe(
          rect.tile.y + rect.tile.height,
        );
        expect(rect.stream.height).toBe(rect.tile.height - TILE_HEADER_TOTAL_PX);
      }
    }
  });

  it("never shifts layout when the sponsored ad rotates", () => {
    const base = tiles(MAX_TILES);
    const before = layoutWorkspace(base.length, VIEWPORT);
    const first = base[0];
    expect(first).toBeDefined();

    defaultAdInventory.ads.forEach((_, index) => {
      const rotated = rotateTileAd(
        { ...(first as TileView), ad: adFor(0) },
        adFor(index),
      );
      const workspace = [rotated, ...base.slice(1)];
      const after = layoutWorkspace(workspace.length, VIEWPORT);
      // The layout-shift assertion: rotating the ad changes no rectangle at all.
      expect(after).toStrictEqual(before);
      expect(after[0]?.chrome).toStrictEqual(before[0]?.chrome);
      expect(after[0]?.stream).toStrictEqual(before[0]?.stream);
      expect(() => validateWorkspaceChrome(workspace, after)).not.toThrow();
    });
  });

  it("splits on the dragged ratios without changing the gutter or chrome", () => {
    const wide = layoutWorkspace(2, VIEWPORT, { column: 0.3 });
    const expected = Math.round((VIEWPORT.width - 14) * 0.3);
    expect(wide[0]?.tile.width).toBe(expected);
    expect(wide[1]?.tile.width).toBe(VIEWPORT.width - expected - 14);
    expect((wide[0]?.tile.width ?? 0) + (wide[1]?.tile.width ?? 0) + 14).toBe(VIEWPORT.width);

    const tall = layoutWorkspace(4, VIEWPORT, { column: 0.35, row: 0.65 });
    const expectedRow = Math.round((VIEWPORT.height - 14) * 0.65);
    expect(tall[0]?.tile.height).toBe(expectedRow);
    // Chrome keeps its reserved height at every split, so ads stay put.
    for (const rect of [...wide, ...tall]) {
      expect(rect.chrome.height).toBe(TILE_CHROME_PX);
      expect(rect.stream.y).toBe(rect.chrome.y + rect.chrome.height);
    }
    expect(() =>
      validateWorkspaceChrome(
        tiles(4).map((tile, index) => (index === 0 ? { ...tile, ad: adFor(0) } : tile)),
        tall,
      ),
    ).not.toThrow();
  });

  it("clamps splits so a tile can never be collapsed or hidden", () => {
    expect(normalizeRatios({ column: 0.95 })).toEqual({ column: MAX_RATIO, row: 0.5 });
    expect(normalizeRatios({ column: 0.01, row: -3 })).toEqual({
      column: MIN_RATIO,
      row: MIN_RATIO,
    });
    expect(clampRatio(Number.NaN)).toBe(DEFAULT_RATIOS.column);
    expect(normalizeRatios()).toEqual(DEFAULT_RATIOS);
  });

  it("exposes keyboard-draggable splitters only where a split exists", () => {
    expect(splitHandles(1, VIEWPORT)).toHaveLength(0);

    const two = splitHandles(2, VIEWPORT, { column: 0.3 });
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ axis: "column", orientation: "vertical", value: 0.3 });
    expect(two[0]?.rect.width).toBeGreaterThanOrEqual(8);

    const three = splitHandles(3, VIEWPORT, { column: 0.4, row: 0.6 });
    expect(three.map((handle) => handle.axis)).toEqual(["column", "row"]);
    // The row splitter only spans the stacked column in a three-tile layout.
    const right = layoutWorkspace(3, VIEWPORT, { column: 0.4 }).map((rect) => rect.tile);
    expect(three[1]?.rect.width).toBe((right[1]?.width ?? 0));

    const four = splitHandles(4, VIEWPORT, { column: 0.5, row: 0.5 });
    expect(four.map((handle) => handle.orientation)).toEqual(["vertical", "horizontal"]);
    expect(four[1]?.rect.width).toBe(VIEWPORT.width);
  });

  it("refuses ads that would break the one-slot, free-plan, labelled rules", () => {
    const free = tiles(2).map((tile, index) =>
      index === 0 ? { ...tile, ad: adFor(0) } : tile,
    );
    expect(() =>
      validateWorkspaceChrome(free, layoutWorkspace(2, VIEWPORT)),
    ).not.toThrow();

    const twoAds = free.map((tile) => ({ ...tile, ad: adFor(1) }));
    expect(() => validateWorkspaceChrome(twoAds, layoutWorkspace(2, VIEWPORT))).toThrow(
      /One sponsored slot/,
    );

    const paid = tiles(1, "paid").map((tile) => ({ ...tile, ad: adFor(0) }));
    expect(() => validateWorkspaceChrome(paid, layoutWorkspace(1, VIEWPORT))).toThrow(
      /Paid accounts/,
    );

    const unlabelled = tiles(1).map((tile) => ({
      ...tile,
      ad: { decision: adFor(0).decision, html: "<aside class=\"sponsored-ad\">Promoted</aside>" },
    }));
    expect(() => validateWorkspaceChrome(unlabelled, layoutWorkspace(1, VIEWPORT))).toThrow(
      /literal label/,
    );

    expect(() => layoutWorkspace(MAX_TILES + 1, VIEWPORT)).toThrow(/at most 4/);
  });
});

describe("desktop stream", () => {
  it("parses build events and ignores anything unknown", () => {
    expect(parseStreamEvent('{"type":"step","step":"schema","status":"ok","detail":"2 tables"}')).toEqual({
      type: "step",
      step: "schema",
      status: "ok",
      detail: "2 tables",
    });
    expect(parseStreamEvent('{"type":"done","url":"http://x/s/a/","app":{"id":"a","name":"A"}}')).toEqual({
      type: "done",
      url: "http://x/s/a/",
      app: { id: "a", name: "A" },
    });
    expect(parseStreamEvent('{"type":"error","message":"nope"}')).toEqual({
      type: "error",
      message: "nope",
    });
    expect(parseStreamEvent("not json")).toBeUndefined();
    expect(parseStreamEvent('{"type":"mystery"}')).toBeUndefined();
    expect(parseStreamEvent('{"type":"done","app":{"id":"a"}}')).toBeUndefined();
  });

  it("turns events into one row each and splits chunked lines", () => {
    const step = parseStreamEvent('{"type":"step","step":"auth","status":"failed","detail":"x"}');
    expect(step === undefined ? undefined : streamEventToLine(step)).toEqual({
      step: "auth",
      status: "failed",
      detail: "x",
    });
    const done = parseStreamEvent('{"type":"done","url":"http://x/","app":{"id":"a","name":"A"}}');
    expect(done === undefined ? undefined : streamEventToLine(done)).toEqual({
      step: "deployed",
      status: "ok",
      detail: "http://x/",
    });
    expect(splitLines('{"a":1}\n{"b"')).toEqual({ lines: ['{"a":1}'], rest: '{"b"' });
  });

  it("caps a workspace at four tiles and keeps finished sessions in history", () => {
    const store = new TileStore();
    for (let index = 0; index < MAX_TILES; index += 1) {
      store.create({ workspace: "build", title: `Session ${String(index + 1)}` });
    }
    expect(() => store.create({ workspace: "build", title: "One too many" })).toThrow(/4 sessions/);
    expect(store.finished()).toHaveLength(0);
    const first = store.list("build")[0];
    expect(first).toBeDefined();
    store.append((first as { id: string }).id, { step: "spec", status: "ok", detail: "" });
    store.finish((first as { id: string }).id, { status: "deployed", appUrl: "http://x/" });
    expect(store.finished()).toHaveLength(1);
    expect(store.list("build")).toHaveLength(MAX_TILES);
  });
});
