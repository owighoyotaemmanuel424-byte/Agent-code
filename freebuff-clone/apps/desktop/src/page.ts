import type { QuotaSnapshot } from "@freebuff/shared";
import { sponsoredAdHtml } from "@freebuff/ads";
import {
  MAX_TILES,
  normalizeRatios,
  TILE_CHROME_PX,
  TILE_HEADER_PX,
  WORKSPACES,
  WORKSPACE_LABELS,
  type TileRatios,
  type TileView,
  type WorkspaceId,
} from "./tiles";

export interface DesktopPageState {
  readonly email: string;
  readonly plan: "free" | "paid";
  readonly quota: QuotaSnapshot;
  readonly apps: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly url: string;
  }[];
}

export interface DesktopPageOptions {
  readonly state: DesktopPageState;
  readonly tiles: readonly TileView[];
  readonly workspace: WorkspaceId;
  readonly counts: Readonly<Record<WorkspaceId, number>>;
  readonly platformUrl: string;
  /** Split ratios of the workspace grid, so a resize survives a reload. */
  readonly ratios?: Partial<TileRatios>;
  /** Rendered as a dismissible line in the top bar, e.g. when a workspace is full. */
  readonly notice?: string;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const initials = (value: string): string => {
  const handle = value.split("@")[0] ?? value;
  const parts = handle.split(/[.\-_]+/).filter((part) => part.length > 0);
  const first = parts[0]?.charAt(0) ?? handle.charAt(0);
  const second = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) : handle.charAt(1);
  return `${first ?? "?"}${second ?? ""}`.toUpperCase() || "?";
};

export const hours = (seconds: number): string => (seconds / 3600).toFixed(2);

const stateLabel: Readonly<Record<TileView["status"], string>> = {
  idle: "ready",
  running: "streaming",
  deployed: "deployed",
  failed: "failed",
};

const tileStream = (tile: TileView): string => {
  const rows =
    tile.lines.length === 0
      ? `<li class="stream-empty">No output yet. ${tile.status === "running" ? "Waiting for the first step…" : "Type a prompt below and build."}</li>`
      : tile.lines
          .map(
            (line) => `<li class="stream-row" data-state="${line.status}">
              <span class="stream-mark" aria-hidden="true">${line.status === "failed" ? "✗" : "✓"}</span>
              <span class="stream-step">${escapeHtml(line.step)}</span>
              <span class="stream-detail">${escapeHtml(line.detail)}</span>
            </li>`,
          )
          .join("\n");
  return `<ol class="stream" id="stream-${escapeHtml(tile.id)}" data-region="stream" aria-live="polite" aria-label="${escapeHtml(tile.title)} output">${rows}</ol>`;
};

const tileChrome = (tile: TileView): string => {
  if (tile.ad !== undefined) {
    return `<div class="tile-ad" data-region="chrome" data-ad-id="${escapeHtml(String(tile.ad.decision.ad.id))}" data-ad-height="${String(TILE_CHROME_PX)}">
      ${sponsoredAdHtml(tile.ad.decision.ad)}
    </div>`;
  }
  const meta =
    tile.appUrl === undefined
      ? `Streams from the platform · ${escapeHtml(tile.prompt === "" ? "one prompt per build" : tile.prompt)}`
      : `Live at <a href="${escapeHtml(tile.appUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tile.appUrl)}</a>`;
  return `<div class="tile-meta" data-region="chrome" data-ad-height="${String(TILE_CHROME_PX)}">${meta}</div>`;
};

const tileBody = (tile: TileView): string =>
  tile.appUrl === undefined
    ? `${tileStream(tile)}
      <form class="tile-composer" data-build="${escapeHtml(tile.id)}">
        <label class="sr-only" for="prompt-${escapeHtml(tile.id)}">Prompt for ${escapeHtml(tile.title)}</label>
        <textarea id="prompt-${escapeHtml(tile.id)}" name="prompt" rows="2" placeholder="Describe the app this session should build." spellcheck="false">${escapeHtml(tile.prompt)}</textarea>
        <div class="tile-composer-foot">
          <span class="tile-hint"><kbd>Ctrl</kbd><kbd>↵</kbd></span>
          <button type="submit" data-role="build">Build</button>
        </div>
      </form>`
    : `${tileStream(tile)}
      <div class="tile-preview">
        <iframe title="${escapeHtml(tile.title)} preview" src="${escapeHtml(tile.appUrl)}" loading="lazy"></iframe>
      </div>`;

const gridStyle = (count: number, ratios: TileRatios): string => {
  if (count < 2) return "";
  const columns = `grid-template-columns:minmax(0, ${String(ratios.column)}fr) minmax(0, ${String(1 - ratios.column)}fr)`;
  if (count === 2) return ` style="${columns}"`;
  const rows = `grid-template-rows:minmax(0, ${String(ratios.row)}fr) minmax(0, ${String(1 - ratios.row)}fr)`;
  return ` style="${columns};${rows}"`;
};

const percent = (value: number): string => String(Math.round(value * 100));

/** Splitters sit in the same gutters the layout model uses. */
const splitters = (count: number, ratios: TileRatios): string => {
  if (count < 2) return "";
  const column = `<button type="button" class="splitter" data-axis="column" role="separator" aria-orientation="vertical" aria-label="Resize columns" aria-valuemin="20" aria-valuemax="80" aria-valuenow="${percent(ratios.column)}" aria-valuetext="${percent(ratios.column)}% of the width" tabindex="0" style="left:calc(${String(ratios.column)} * 100% - 5px)"></button>`;
  if (count === 2) return column;
  // Three tiles only split rows inside the stacked column, so the handle starts
  // at the column gutter instead of spanning the whole workspace.
  const rowStyle =
    count === 3
      ? `left:calc(${String(ratios.column)} * 100% + 5px);right:0;top:calc(${String(ratios.row)} * 100% - 5px)`
      : `top:calc(${String(ratios.row)} * 100% - 5px)`;
  const row = `<button type="button" class="splitter" data-axis="row" role="separator" aria-orientation="horizontal" aria-label="Resize rows" aria-valuemin="20" aria-valuemax="80" aria-valuenow="${percent(ratios.row)}" aria-valuetext="${percent(ratios.row)}% of the height" tabindex="0" style="${rowStyle}"></button>`;
  return `${column}${row}`;
};

const tileMarkup = (tile: TileView): string => `<article class="tile" data-tile-id="${escapeHtml(tile.id)}" data-status="${tile.status}" data-workspace="${tile.workspace}" aria-labelledby="title-${escapeHtml(tile.id)}">
  <header class="tile-head">
    <span class="tile-dot" aria-hidden="true"></span>
    <h2 class="tile-title" id="title-${escapeHtml(tile.id)}">${escapeHtml(tile.title)}</h2>
    <span class="tile-state" data-role="state">${stateLabel[tile.status]}</span>
    <a class="tile-link" href="${tile.appUrl === undefined ? "#" : escapeHtml(tile.appUrl)}" ${tile.appUrl === undefined ? 'aria-disabled="true" tabindex="-1"' : 'target="_blank" rel="noopener noreferrer"'}>Open</a>
    <form class="tile-close" method="post" action="/api/tiles/${escapeHtml(tile.id)}/close">
      <button type="submit" class="tile-close-button" aria-label="Close ${escapeHtml(tile.title)}">✕</button>
    </form>
  </header>
  ${tileChrome(tile)}
  <div class="tile-body" data-region="body">
    ${tileBody(tile)}
  </div>
</article>`;

const workspaceTabs = (
  workspace: WorkspaceId,
  counts: Readonly<Record<WorkspaceId, number>>,
): string =>
  WORKSPACES.map((id) => {
    const current = id === workspace;
    return `<a class="workspace-tab" href="/?workspace=${id}" data-workspace-tab="${id}"${
      current ? ' aria-current="page"' : ""
    }>${WORKSPACE_LABELS[id]}<span class="workspace-count">${String(counts[id])}</span></a>`;
  }).join("");

const emptyWorkspace = (workspace: WorkspaceId): string => {
  const copy: Readonly<Record<WorkspaceId, string>> = {
    build: "No sessions yet. Add a tile and describe an app to start streaming.",
    history: "Nothing finished yet. A completed build keeps its log here.",
    apps: "No deployed apps yet. Build one to see it tiled with a live preview.",
  };
  return `<div class="tiles-empty">
    <p>${copy[workspace]}</p>
    ${
      workspace === "build"
        ? `<form class="tiles-empty-form" method="post" action="/api/tiles"><input type="hidden" name="workspace" value="build" /><button type="submit">Add a tile</button></form>`
        : ""
    }
  </div>`;
};

export const renderDesktopPage = (options: DesktopPageOptions): string => {
  const { state, workspace } = options;
  const quotaLimitSeconds = state.quota.hoursPerDay * 3600;
  const quotaPercent =
    quotaLimitSeconds <= 0
      ? 0
      : Math.min(100, Math.max(0, (state.quota.consumedSecondsToday / quotaLimitSeconds) * 100));
  const tiles = options.tiles;
  const ratios = normalizeRatios(options.ratios);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>freebuff desktop · ${escapeHtml(WORKSPACE_LABELS[workspace])}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2.5 14.9 9l6.6 3-6.6 3L12 21.5 9.1 15 2.5 12l6.6-3L12 2.5Z' fill='%237c8cff'/%3E%3C/svg%3E" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: dark;
    --bg: #07090f;
    --text: #e9edf7;
    --muted: #9aa5b8;
    --faint: #6d778a;
    --border: rgba(255, 255, 255, 0.09);
    --border-strong: rgba(255, 255, 255, 0.18);
    --panel: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.015));
    --accent: #7c8cff;
    --accent-2: #22d3ee;
    --ok: #4ade80;
    --danger: #ff7a90;
    --radius: 18px;
    --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    --tile-header: ${String(TILE_HEADER_PX)}px;
    --tile-chrome: ${String(TILE_CHROME_PX)}px;
  }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
    font: 14px/1.55 var(--font); -webkit-font-smoothing: antialiased;
  }
  body::before {
    content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background:
      radial-gradient(900px 500px at 8% -10%, rgba(124, 140, 255, 0.2), transparent 65%),
      radial-gradient(760px 460px at 95% -6%, rgba(34, 211, 238, 0.14), transparent 62%),
      radial-gradient(900px 620px at 55% 118%, rgba(168, 85, 247, 0.1), transparent 70%);
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: #b8c1ff; }
  code { font-family: var(--mono); font-size: 0.92em; }
  kbd {
    display: inline-block; padding: 1px 5px; border-radius: 5px; font: 10.5px/1.5 var(--mono);
    color: var(--muted); border: 1px solid var(--border); background: rgba(255, 255, 255, 0.05);
  }

  /* window frame */
  .shell {
    display: grid; grid-template-columns: 248px minmax(0, 1fr);
    min-height: 100vh;
  }

  /* sidebar: account, quota, apps — the sponsored slot lives in tile chrome */
  aside.sidebar {
    display: flex; flex-direction: column; gap: 16px;
    padding: 18px 16px 20px;
    border-right: 1px solid var(--border);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
    backdrop-filter: blur(16px);
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); }
  .brand:hover { color: var(--text); }
  .brand-mark {
    display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: #fff;
    background: linear-gradient(140deg, #7c8cff, #22d3ee 65%, #a855f7);
    box-shadow: 0 6px 16px rgba(124, 140, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .brand-mark svg { width: 16px; height: 16px; }
  .brand-name { font-weight: 650; letter-spacing: -0.02em; font-size: 15px; }
  .brand-tag {
    font-size: 10px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 7px;
  }
  .account {
    display: flex; align-items: center; gap: 10px;
    border: 1px solid var(--border); border-radius: 14px; padding: 10px 11px;
    background: rgba(255, 255, 255, 0.03);
  }
  .avatar {
    display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 10px;
    font-size: 12.5px; font-weight: 650; color: #0a0d16;
    background: linear-gradient(140deg, #aab4ff, #22d3ee);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }
  .account-body { min-width: 0; }
  .account-email {
    display: block; font-size: 12.5px; font-weight: 550; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .account-plan { font-size: 11.5px; color: var(--faint); text-transform: capitalize; }
  .side-section { display: grid; gap: 7px; }
  .side-label {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    font-size: 10.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase; color: var(--faint);
  }
  .side-label .value { color: var(--text); font-weight: 600; letter-spacing: 0; text-transform: none; font-size: 12.5px; }
  .meter {
    height: 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); overflow: hidden;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
  }
  .meter > span {
    display: block; height: 100%; border-radius: inherit;
    background: linear-gradient(90deg, #7c8cff, #22d3ee);
    box-shadow: 0 0 12px rgba(34, 211, 238, 0.4);
  }
  .side-meta { font-size: 11.5px; color: var(--faint); }
  .side-meta strong { color: var(--muted); font-weight: 550; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: capitalize;
    color: #cfd6ff; background: rgba(124, 140, 255, 0.14);
    border: 1px solid rgba(124, 140, 255, 0.3); border-radius: 999px; padding: 3px 9px;
  }
  .sidebar-footer { margin-top: auto; font-size: 11px; color: var(--faint); line-height: 1.6; }

  .apps { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
  .app-card {
    display: flex; align-items: center; gap: 9px; min-width: 0;
    border: 1px solid var(--border); border-radius: 11px; padding: 8px 10px;
    background: rgba(255, 255, 255, 0.02);
  }
  .app-avatar {
    display: grid; place-items: center; flex: none; width: 26px; height: 26px;
    border-radius: 8px; font-size: 11px; font-weight: 650; color: #0a0d16;
    background: linear-gradient(140deg, #aab4ff, #22d3ee);
  }
  .app-name {
    display: block; font-size: 12.5px; font-weight: 550; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .app-meta { margin: 0; font-size: 11px; color: var(--faint); }
  .empty { padding: 14px 8px; text-align: center; color: var(--faint); font-size: 12px;
    border: 1px dashed var(--border); border-radius: 11px; }

  /* ---------- workspace ---------- */
  main { padding: 16px 18px 18px; min-width: 0; display: flex; flex-direction: column; }
  .topbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .workspaces {
    display: inline-flex; align-items: center; gap: 4px; padding: 4px;
    border: 1px solid var(--border); border-radius: 12px; background: rgba(0, 0, 0, 0.28);
  }
  .workspace-tab {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 6px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 560; color: var(--muted);
  }
  .workspace-tab:hover { color: var(--text); background: rgba(255, 255, 255, 0.05); }
  .workspace-tab[aria-current="page"] {
    color: #0b0e17; background: linear-gradient(135deg, #aab4ff, #7c8cff 60%, #22d3ee);
    box-shadow: 0 6px 16px -10px rgba(124, 140, 255, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .workspace-count {
    font: 600 10.5px/1 var(--mono); color: inherit; opacity: 0.72;
    border-radius: 999px; padding: 2px 5px; background: rgba(0, 0, 0, 0.16);
  }
  .topbar .spacer { flex: 1; }
  .notice {
    margin: 0; padding: 6px 11px; font-size: 11.5px; color: #ffd0d8;
    border: 1px solid rgba(255, 122, 144, 0.32); border-radius: 9px;
    background: rgba(255, 122, 144, 0.08);
  }
  .topbar-actions { display: inline-flex; align-items: center; gap: 8px; }
  .ghost {
    font: 550 12px/1 var(--font); color: var(--muted); cursor: pointer;
    padding: 7px 11px; border-radius: 9px; border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03); display: inline-flex; align-items: center; gap: 6px;
  }
  .ghost:hover { color: var(--text); border-color: var(--border-strong); }
  .ghost:disabled { opacity: 0.5; cursor: progress; }
  .platform-chip {
    display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
    font-size: 11px; color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px; padding: 5px 10px;
    background: rgba(255, 255, 255, 0.03);
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok);
    box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.16); flex: none; }

  .workspace { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .tiles {
    display: grid; gap: 14px; flex: 1; min-height: 560px;
    height: calc(100vh - 96px); position: relative;
  }
  .tiles[data-count="1"] { grid-template-columns: minmax(0, 1fr); }
  .tiles[data-count="2"] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .tiles[data-count="3"] {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .tiles[data-count="3"] > .tile:first-child { grid-row: span 2; }
  .tiles[data-count="4"] {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }

  /* splitters live in the gutters and resize chrome and stream together */
  .splitter {
    position: absolute; z-index: 4; padding: 0; border: 0; background: transparent;
    touch-action: none; border-radius: 999px;
  }
  .splitter[data-axis="column"] { width: 10px; top: 0; bottom: 0; cursor: col-resize; }
  .splitter[data-axis="row"] { height: 10px; left: 0; right: 0; cursor: row-resize; }
  .splitter::after {
    content: ""; position: absolute; inset: 0; margin: auto;
    border-radius: 999px; background: var(--border-strong);
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }
  .splitter[data-axis="column"]::after { width: 2px; height: 46%; }
  .splitter[data-axis="row"]::after { height: 2px; width: 46%; }
  .splitter:hover::after, .splitter:focus-visible::after, .splitter[data-dragging="true"]::after {
    background: var(--accent); box-shadow: 0 0 0 3px rgba(124, 140, 255, 0.18);
  }
  .splitter:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .tile {
    display: grid; grid-template-rows: var(--tile-header) var(--tile-chrome) minmax(0, 1fr);
    min-width: 0; min-height: 0; overflow: hidden;
    border: 1px solid var(--border-strong); border-radius: var(--radius);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.012)), #0a0d16;
    box-shadow: 0 28px 70px -40px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .tile[data-status="running"] { border-color: rgba(124, 140, 255, 0.45); }
  .tile[data-status="failed"] { border-color: rgba(255, 122, 144, 0.4); }

  .tile-head {
    display: flex; align-items: center; gap: 8px; min-width: 0;
    padding: 0 12px; border-bottom: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
  }
  .tile-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex: none; }
  .tile[data-status="running"] .tile-dot { background: var(--accent); box-shadow: 0 0 0 3px rgba(124, 140, 255, 0.18); }
  .tile[data-status="deployed"] .tile-dot { background: var(--ok); box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.16); }
  .tile[data-status="failed"] .tile-dot { background: var(--danger); box-shadow: 0 0 0 3px rgba(255, 122, 144, 0.16); }
  .tile-title {
    margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tile-state {
    font: 500 10.5px/1 var(--mono); color: var(--faint); text-transform: lowercase;
    border: 1px solid var(--border); border-radius: 999px; padding: 3px 7px;
  }
  .tile-link { font-size: 11.5px; color: var(--muted); margin-left: auto; }
  .tile-link:hover { color: var(--accent); }
  .tile-link[aria-disabled="true"] { opacity: 0.35; pointer-events: none; }
  .tile-close { margin: 0; }
  .tile-close-button {
    font: 11px/1 var(--font); color: var(--faint); cursor: pointer;
    background: transparent; border: 0; padding: 4px 6px; border-radius: 6px;
  }
  .tile-close-button:hover { color: var(--text); background: rgba(255, 255, 255, 0.07); }

  /* chrome: the only place sponsored content may appear, fixed height always */
  .tile-ad, .tile-meta {
    height: var(--tile-chrome); min-height: var(--tile-chrome); max-height: var(--tile-chrome);
    overflow: hidden; border-bottom: 1px solid var(--border);
    display: flex; align-items: center;
  }
  .tile-meta { padding: 0 14px; font-size: 11.5px; color: var(--faint); line-height: 1.45; }
  .tile-ad { padding: 0 12px; }
  .tile-ad .sponsored-ad {
    width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr);
    column-gap: 10px; row-gap: 1px; align-items: center;
    border: 1px solid rgba(34, 211, 238, 0.22); border-radius: 11px; padding: 7px 10px;
    background: linear-gradient(160deg, rgba(34, 211, 238, 0.1), rgba(124, 140, 255, 0.06) 60%, rgba(255, 255, 255, 0.02));
  }
  .tile-ad .sponsored-label {
    grid-row: span 2; font-size: 9px; font-weight: 650; letter-spacing: 0.1em; text-transform: uppercase;
    color: #bfe9f5; border: 1px solid rgba(34, 211, 238, 0.35); border-radius: 999px;
    padding: 2px 6px; background: rgba(34, 211, 238, 0.1); white-space: nowrap;
  }
  .tile-ad strong {
    font-size: 12px; font-weight: 600; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tile-ad p, .tile-ad a { display: none; }
  .tile-ad a.tile-ad-link { display: none; }

  .tile-body { display: flex; flex-direction: column; min-height: 0; }
  .stream {
    list-style: none; margin: 0; padding: 10px 12px; flex: 1; min-height: 0;
    overflow-y: auto; display: grid; gap: 4px; align-content: start;
    font-size: 12px; line-height: 1.5;
  }
  .stream-empty { color: var(--faint); font-size: 12px; padding: 2px 0; }
  .stream-row {
    display: grid; grid-template-columns: 12px auto minmax(0, 1fr); gap: 8px; align-items: baseline;
    padding: 4px 7px; border-radius: 7px; background: rgba(255, 255, 255, 0.025);
    border: 1px solid transparent;
  }
  .stream-row[data-state="failed"] { background: rgba(255, 122, 144, 0.07); border-color: rgba(255, 122, 144, 0.22); }
  .stream-mark { font-family: var(--mono); color: var(--ok); font-size: 10.5px; }
  .stream-row[data-state="failed"] .stream-mark { color: var(--danger); }
  .stream-step { font: 600 11px/1.5 var(--mono); color: var(--text); }
  .stream-detail { color: var(--faint); overflow-wrap: anywhere; }

  .tile-composer { border-top: 1px solid var(--border); background: rgba(0, 0, 0, 0.25); }
  .tile-composer textarea {
    display: block; width: 100%; resize: none; border: 0; outline: none; background: transparent;
    color: inherit; padding: 9px 12px 2px; font: 12.5px/1.5 var(--font);
  }
  .tile-composer textarea::placeholder { color: var(--faint); }
  .tile-composer-foot { display: flex; align-items: center; gap: 8px; padding: 0 10px 9px; }
  .tile-hint { display: inline-flex; gap: 3px; }
  .spacer { flex: 1; }
  .tile-composer button, .tiles-empty-form button {
    font: 600 11.5px/1 var(--font); color: #080b14; cursor: pointer;
    padding: 7px 13px; border: 0; border-radius: 9px;
    background: linear-gradient(135deg, #aab4ff, #7c8cff 45%, #22d3ee);
    box-shadow: 0 8px 20px -12px rgba(124, 140, 255, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .tile-composer button:hover, .tiles-empty-form button:hover { filter: brightness(1.06); }
  .tile-composer button:disabled { cursor: progress; opacity: 0.6; }
  .tile-preview { flex: 1; min-height: 0; border-top: 1px solid var(--border); background: #05070c; }
  .tile-preview iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }

  .tiles-empty {
    grid-column: 1 / -1; display: grid; place-items: center; gap: 14px; text-align: center;
    border: 1px dashed var(--border-strong); border-radius: var(--radius);
    padding: 40px 20px; color: var(--faint); font-size: 13px; background: rgba(255, 255, 255, 0.015);
  }
  .tiles-empty p { margin: 0; max-width: 40ch; }
  .tiles-empty-form { margin: 0; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  @media (max-width: 980px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    aside.sidebar {
      position: static; height: auto; flex-direction: row; flex-wrap: wrap;
      align-items: center; border-right: 0; border-bottom: 1px solid var(--border); gap: 12px;
    }
    aside.sidebar .side-section, aside.sidebar .apps, .sidebar-footer { flex: 1 1 220px; }
    .sidebar-footer { margin-top: 0; }
    main { padding: 14px; }
    .tiles {
      height: auto; min-height: 0;
      grid-template-columns: minmax(0, 1fr) !important;
      grid-template-rows: none !important;
    }
    .tiles[data-count="3"] > .tile:first-child { grid-row: auto; }
    .tile { min-height: 420px; }
    .splitter { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="freebuff desktop home">
      <span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 14.9 9l6.6 3-6.6 3L12 21.5 9.1 15 2.5 12l6.6-3L12 2.5Z" fill="currentColor" opacity=".92"/></svg></span>
      <span class="brand-name">freebuff</span>
      <span class="brand-tag">desktop</span>
    </a>

    <div class="account">
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(state.email))}</span>
      <span class="account-body">
        <span class="account-email" title="${escapeHtml(state.email)}">${escapeHtml(state.email)}</span>
        <span class="account-plan">${escapeHtml(state.plan)} plan</span>
      </span>
    </div>

    <div class="side-section">
      <div class="side-label"><span>Daily quota</span><span class="value">${hours(state.quota.consumedSecondsToday)}h / ${String(state.quota.hoursPerDay)}h</span></div>
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${quotaPercent.toFixed(0)}" aria-label="Daily quota used">
        <span style="width: ${quotaPercent.toFixed(1)}%"></span>
      </div>
      <div class="side-meta">Resets <strong>${escapeHtml(state.quota.resetsAt)}</strong></div>
      <div class="side-meta">${state.quota.adsEnabled ? "Ads shown on the free tier" : "No ads on this account"}</div>
    </div>

    <div class="side-section">
      <div class="side-label"><span>Apps</span><span>${
        state.apps.length === 1 ? "1 app" : `${String(state.apps.length)} apps`
      }</span></div>
      <ul class="apps" id="apps">
        ${
          state.apps.length === 0
            ? `<li class="empty">No apps yet</li>`
            : state.apps
                .map(
                  (app) => `<li class="app-card">
          <span class="app-avatar" aria-hidden="true">${escapeHtml(initials(app.name))}</span>
          <span style="min-width:0">
            <a class="app-name" href="${escapeHtml(app.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.name)}</a>
            <p class="app-meta">${escapeHtml(app.status)}</p>
          </span>
        </li>`,
                )
                .join("\n        ")
        }
      </ul>
    </div>

    <div class="sidebar-footer">
      Local shell over the platform API.<br />
      <code>${escapeHtml(options.platformUrl)}</code>
    </div>
  </aside>

  <main>
    <div class="topbar">
      <nav class="workspaces" aria-label="Workspaces">
        ${workspaceTabs(workspace, options.counts)}
      </nav>
      ${options.notice === undefined ? "" : `<p class="notice" role="status">${escapeHtml(options.notice)}</p>`}
      <span class="spacer"></span>
      <div class="topbar-actions">
        <button type="button" class="ghost" id="rotate-ad">↻ Next sponsored</button>
        ${
          workspace !== "build"
            ? ""
            : options.counts.build >= MAX_TILES
              ? `<button type="button" class="ghost" disabled title="A workspace tiles ${String(MAX_TILES)} sessions">+ Tile</button>`
              : `<form method="post" action="/api/tiles" style="margin:0">
          <input type="hidden" name="workspace" value="build" />
          <button type="submit" class="ghost">+ Tile</button>
        </form>`
        }
        <span class="platform-chip"><span class="dot"></span> platform connected</span>
      </div>
    </div>

    <section class="workspace" data-workspace="${workspace}" aria-label="${WORKSPACE_LABELS[workspace]} workspace">
      ${
        tiles.length === 0
          ? emptyWorkspace(workspace)
          : `<div class="tiles" data-count="${String(tiles.length)}" data-workspace="${workspace}" data-column="${String(ratios.column)}" data-row="${String(ratios.row)}" data-rows="${tiles.length > 2 ? "true" : "false"}"${gridStyle(tiles.length, ratios)}>
        ${tiles.map((tile) => tileMarkup(tile)).join("\n        ")}
        ${splitters(tiles.length, ratios)}
      </div>`
      }
    </section>
  </main>
</div>
<script>
(function () {
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function row(line) {
    var item = el('li', 'stream-row');
    item.setAttribute('data-state', line.status === 'failed' ? 'failed' : 'ok');
    item.appendChild(el('span', 'stream-mark', line.status === 'failed' ? '✗' : '✓'));
    item.appendChild(el('span', 'stream-step', line.step));
    item.appendChild(el('span', 'stream-detail', line.detail));
    return item;
  }

  function setState(tile, text) {
    var chip = tile.querySelector('[data-role="state"]');
    if (chip) chip.textContent = text;
  }

  function handleEvent(tile, list, empty, event) {
    if (event.type === 'step') {
      if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
      var failed = String(event.status || '').toLowerCase() === 'failed';
      list.appendChild(row({ status: failed ? 'failed' : 'ok', step: event.step, detail: event.detail || '' }));
      list.scrollTop = list.scrollHeight;
      return;
    }
    if (event.type === 'done') {
      if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
      list.appendChild(row({ status: 'ok', step: 'deployed', detail: event.url }));
      tile.setAttribute('data-status', 'deployed');
      setState(tile, 'deployed');
      var open = tile.querySelector('.tile-link');
      if (open) {
        open.href = event.url;
        open.removeAttribute('aria-disabled');
        open.removeAttribute('tabindex');
        open.setAttribute('target', '_blank');
        open.setAttribute('rel', 'noopener noreferrer');
      }
      return;
    }
    if (event.type === 'error') {
      if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
      list.appendChild(row({ status: 'failed', step: 'error', detail: event.message || 'Build failed' }));
      tile.setAttribute('data-status', 'failed');
      setState(tile, 'failed');
    }
  }

  function readStream(tile, list, empty, response) {
    if (!response.body || !response.body.getReader) {
      return response.json().then(function (body) {
        handleEvent(tile, list, empty, { type: 'error', message: body.message || 'Build failed' });
      });
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (buffer.trim()) {
            try { handleEvent(tile, list, empty, JSON.parse(buffer)); } catch (ignored) {}
          }
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        lines.forEach(function (text) {
          if (!text.trim()) return;
          try { handleEvent(tile, list, empty, JSON.parse(text)); } catch (ignored) {}
        });
        return pump();
      });
    }
    return pump();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tile-composer'), function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var tile = form.closest('.tile');
      var tileId = form.getAttribute('data-build');
      var prompt = form.querySelector('textarea');
      var button = form.querySelector('button[data-role="build"]');
      if (!tile || !tileId || !prompt || !prompt.value.trim() || (button && button.disabled)) return;
      var list = tile.querySelector('[data-region="stream"]');
      var empty = list ? list.querySelector('.stream-empty') : null;
      if (list) list.textContent = '';
      if (button) button.disabled = true;
      tile.setAttribute('data-status', 'running');
      setState(tile, 'streaming');
      fetch('/api/tiles/' + encodeURIComponent(tileId) + '/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.value })
      }).then(function (response) {
        if (!response.ok) {
          return response.json().then(function (body) {
            throw new Error(body.message || 'Build failed');
          });
        }
        return readStream(tile, list, empty, response);
      }).catch(function (error) {
        if (list) list.appendChild(row({ status: 'failed', step: 'error', detail: error.message || 'Build failed' }));
        tile.setAttribute('data-status', 'failed');
        setState(tile, 'failed');
      }).finally(function () {
        if (button) button.disabled = false;
      });
    });
  });

  var grid = document.querySelector('.tiles');
  if (grid) {
    var workspaceId = grid.getAttribute('data-workspace') || 'build';
    var hasRows = grid.getAttribute('data-rows') === 'true';
    var ratios = {
      column: parseFloat(grid.getAttribute('data-column') || '0.5'),
      row: parseFloat(grid.getAttribute('data-row') || '0.5')
    };
    var splitters = document.querySelectorAll('.splitter');

    function clamp(value) { return Math.min(0.8, Math.max(0.2, value)); }

    function paint() {
      grid.setAttribute('data-column', String(ratios.column));
      grid.setAttribute('data-row', String(ratios.row));
      grid.style.gridTemplateColumns =
        'minmax(0, ' + ratios.column + 'fr) minmax(0, ' + (1 - ratios.column) + 'fr)';
      if (hasRows) {
        grid.style.gridTemplateRows =
          'minmax(0, ' + ratios.row + 'fr) minmax(0, ' + (1 - ratios.row) + 'fr)';
      }
      Array.prototype.forEach.call(splitters, function (handle) {
        var axis = handle.getAttribute('data-axis');
        var value = axis === 'row' ? ratios.row : ratios.column;
        var percent = Math.round(value * 100);
        handle.setAttribute('aria-valuenow', String(percent));
        handle.setAttribute('aria-valuetext', percent + '% of the ' + (axis === 'row' ? 'height' : 'width'));
        if (axis === 'row') handle.style.top = 'calc(' + value + ' * 100% - 5px)';
        else handle.style.left = 'calc(' + value + ' * 100% - 5px)';
      });
    }

    function save() {
      fetch('/api/layout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace: workspaceId,
          column: Math.round(ratios.column * 1000) / 1000,
          row: Math.round(ratios.row * 1000) / 1000
        })
      }).catch(function () {});
    }

    Array.prototype.forEach.call(splitters, function (handle) {
      var axis = handle.getAttribute('data-axis') === 'row' ? 'row' : 'column';

      handle.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
        handle.setAttribute('data-dragging', 'true');
        var box = grid.getBoundingClientRect();

        function move(moveEvent) {
          var next = axis === 'row'
            ? (moveEvent.clientY - box.top) / box.height
            : (moveEvent.clientX - box.left) / box.width;
          ratios[axis] = clamp(next);
          paint();
        }

        function end() {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          handle.removeAttribute('data-dragging');
          save();
        }

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });

      handle.addEventListener('keydown', function (event) {
        var handled = true;
        if (axis === 'row') {
          if (event.key === 'ArrowUp') ratios.row = clamp(ratios.row - 0.04);
          else if (event.key === 'ArrowDown') ratios.row = clamp(ratios.row + 0.04);
          else if (event.key === 'Home') ratios.row = 0.5;
          else handled = false;
        } else {
          if (event.key === 'ArrowLeft') ratios.column = clamp(ratios.column - 0.04);
          else if (event.key === 'ArrowRight') ratios.column = clamp(ratios.column + 0.04);
          else if (event.key === 'Home') ratios.column = 0.5;
          else handled = false;
        }
        if (!handled) return;
        event.preventDefault();
        paint();
        save();
      });
    });
  }

  var rotate = document.getElementById('rotate-ad');
  if (rotate) {
    rotate.addEventListener('click', function () {
      var slot = document.querySelector('[data-region="chrome"][data-ad-id]');
      var workspace = document.querySelector('.workspace');
      if (!slot || !workspace) return;
      rotate.disabled = true;
      fetch('/api/ads/rotate?workspace=' + encodeURIComponent(workspace.getAttribute('data-workspace') || 'build'))
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (body) {
          if (!body || !body.html) return;
          slot.innerHTML = body.html;
          slot.setAttribute('data-ad-id', String(body.adId));
        })
        .finally(function () { rotate.disabled = false; });
    });
  }
})();
</script>
</body>
</html>`;
};
