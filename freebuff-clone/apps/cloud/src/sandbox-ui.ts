import { webThemeCss } from "@freebuff/shared";
import type { SandboxStatus } from "@freebuff/sandbox-orchestrator";
import { timelineHtml } from "./timeline";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const BRAND_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 2.5 14.9 9l6.6 3-6.6 3L12 21.5 9.1 15 2.5 12l6.6-3L12 2.5Z" fill="currentColor" opacity=".92"/>
</svg>`;

export interface PreviewPaneInput {
  readonly status?: SandboxStatus;
  readonly shareUrl?: string;
}

const phaseLabel = (phase: SandboxStatus["phase"]): string => {
  switch (phase) {
    case "creating":
      return "provisioning";
    case "ready":
      return "running";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return phase;
  }
};

/**
 * The preview pane. Sponsored slots are never rendered here (design rule R1):
 * this function only produces the iframe, the open-in-new-tab link, the share
 * field and the copy button.
 */
export const previewPaneHtml = (input: PreviewPaneInput): string => {
  const status = input.status;
  const live = status !== undefined && status.phase !== "stopped" && status.phase !== "failed";
  const previewUrl = live ? status.previewUrl : undefined;
  const frame =
    previewUrl === undefined
      ? `<div class="frame frame-empty"><p>No preview yet. The timeline shows what the sandbox is doing.</p></div>`
      : `<div class="frame"><iframe id="preview-frame" src="${escapeHtml(previewUrl)}" title="Sandbox preview" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms"></iframe></div>`;
  const shareRow =
    previewUrl === undefined
      ? ""
      : [
          `<div class="share-row">`,
          `<label class="visually-hidden" for="share-url">Shareable preview link</label>`,
          `<input id="share-url" class="share-field" type="text" readonly value="${escapeHtml(input.shareUrl ?? previewUrl)}" />`,
          `<button type="button" class="btn" data-share="/api/sandboxes/${escapeHtml(String(status?.sandboxId ?? ""))}/share">Copy link</button>`,
          `<span id="share-status" class="hint" role="status" aria-live="polite"></span>`,
          `</div>`,
        ].join("");
  return [
    `<section class="preview" id="preview" aria-labelledby="preview-title">`,
    `<div class="preview-head">`,
    `<h2 id="preview-title">Live preview</h2>`,
    previewUrl === undefined
      ? ""
      : `<a class="btn btn-ghost" href="${escapeHtml(previewUrl)}" target="_blank" rel="noopener noreferrer">Open in new tab</a>`,
    `</div>`,
    frame,
    shareRow,
    `</section>`,
  ].join("");
};

const sandboxListHtml = (
  sandboxes: readonly SandboxStatus[],
  selectedId: string | undefined,
): string => {
  if (sandboxes.length === 0) {
    return `<p class="hint" id="list-empty">No sandboxes yet. Start one from a repository URL.</p>`;
  }
  return [
    `<ul class="sandbox-list" id="sandbox-list">`,
    ...sandboxes.map((sandbox) => {
      const id = String(sandbox.sandboxId);
      const selected = id === selectedId;
      return [
        `<li${selected ? ` class="is-selected"` : ""}>`,
        `<a href="/sandboxes?sandbox=${encodeURIComponent(id)}"${selected ? ` aria-current="page"` : ""}>`,
        `<span class="repo-name">${escapeHtml(id)}</span>`,
        `<span class="repo-meta" data-phase="${sandbox.phase}">${escapeHtml(phaseLabel(sandbox.phase))} · ${escapeHtml(sandbox.startedAt)}</span>`,
        `</a>`,
        `</li>`,
      ].join("");
    }),
    `</ul>`,
  ].join("");
};

const detailHtml = (
  status: SandboxStatus | undefined,
  shareUrl: string | undefined,
  notice: string | undefined,
): string => {
  if (status === undefined) {
    return [
      `<div class="detail-empty">`,
      `<h2>No sandbox selected</h2>`,
      `<p>Pick a sandbox on the left, or paste a repository URL to provision a new one.</p>`,
      ...(notice === undefined ? [] : [`<p class="notice" role="status">${escapeHtml(notice)}</p>`]),
      `</div>`,
    ].join("");
  }
  const id = String(status.sandboxId);
  return [
    `<div class="detail-head">`,
    `<div><p class="crumb">sandbox · ${escapeHtml(id)}</p>`,
    `<h1>${escapeHtml(id)}</h1></div>`,
    `<span class="phase-pill" data-phase="${status.phase}">${escapeHtml(phaseLabel(status.phase))}</span>`,
    `</div>`,
    `<p class="hint">Started ${escapeHtml(status.startedAt)}${status.error === undefined ? "" : ` · ${escapeHtml(status.error)}`}</p>`,
    timelineHtml({
      phase: status.phase,
      ...(status.error === undefined ? {} : { error: status.error }),
    }),
    previewPaneHtml({
      status,
      ...(shareUrl === undefined ? {} : { shareUrl }),
    }),
    [
      `<section class="actions" aria-label="Sandbox actions">`,
      `<button type="button" class="btn btn-ghost" data-action="stop">Stop sandbox</button>`,
      `<button type="button" class="btn btn-danger" data-action="remove">Delete sandbox</button>`,
      `<span id="action-status" class="hint" role="status" aria-live="polite"></span>`,
      `</section>`,
    ].join(""),
    [
      `<details class="logs">`,
      `<summary>Logs (${String(status.logs.length)} lines)</summary>`,
      `<pre id="sandbox-logs">${escapeHtml(status.logs.slice(-40).join("\n"))}</pre>`,
      `</details>`,
    ].join(""),
  ].join("");
};

export interface SandboxPageOptions {
  readonly providerName: string;
  readonly previewHint: string;
  readonly sandboxes: readonly SandboxStatus[];
  readonly selected?: SandboxStatus;
  readonly shareUrl?: string;
  readonly notice?: string;
  readonly githubClientId?: string;
  readonly adHtml?: string;
}

/** List-detail shell. The sponsored slot lives in the left rail, never in the preview. */
export const sandboxPageHtml = (options: SandboxPageOptions): string => {
  const selectedId =
    options.selected === undefined ? undefined : String(options.selected.sandboxId);
  const github =
    options.githubClientId === undefined
      ? [
          `<button type="button" class="btn btn-ghost" disabled aria-describedby="github-hint">Connect GitHub</button>`,
          `<p class="hint" id="github-hint">GitHub OAuth needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET. Paste a repository URL below in the meantime.</p>`,
        ].join("")
      : `<a class="btn" href="https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(options.githubClientId)}&scope=repo">Connect GitHub</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>freebuff cloud sandboxes</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2.5 14.9 9l6.6 3-6.6 3L12 21.5 9.1 15 2.5 12l6.6-3L12 2.5Z' fill='%237c8cff'/%3E%3C/svg%3E" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: dark;
    ${webThemeCss()}
    --bg: var(--surface);
    --text: var(--text-primary);
    --muted: var(--text-muted);
    --faint: #6d778a;
    --border: rgba(255, 255, 255, 0.09);
    --border-strong: rgba(255, 255, 255, 0.18);
    --panel: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.015));
    --accent-2: #22d3ee;
    --ok: var(--success);
    --radius: 18px;
    --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
    font: 15px/1.6 var(--font); -webkit-font-smoothing: antialiased;
  }
  body::before {
    content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background:
      radial-gradient(880px 500px at 10% -10%, rgba(124, 140, 255, 0.22), transparent 65%),
      radial-gradient(760px 460px at 92% -6%, rgba(34, 211, 238, 0.15), transparent 62%);
  }
  .wrap { width: min(1180px, 100% - 40px); margin-inline: auto; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: #b8c1ff; }
  code, pre { font-family: var(--mono); }

  .topbar { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--border);
    background: rgba(7, 9, 15, 0.72); backdrop-filter: blur(18px) saturate(140%); }
  .topbar-inner { display: flex; align-items: center; gap: 12px; height: 64px; flex-wrap: wrap; }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); }
  .brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: #fff;
    background: linear-gradient(140deg, #7c8cff, #22d3ee 65%, #a855f7);
    box-shadow: 0 6px 18px rgba(124, 140, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4); }
  .brand-mark svg { width: 18px; height: 18px; }
  .brand-name { font-weight: 650; letter-spacing: -0.02em; font-size: 16px; }
  .brand-tag { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }
  .topnav { display: flex; gap: 4px; margin-left: 12px; }
  .topnav a { font-size: 13px; color: var(--muted); padding: 6px 10px; border-radius: 9px; }
  .topnav a:hover { color: var(--text); background: rgba(255, 255, 255, 0.05); }
  .topnav a[aria-current="page"] { color: var(--text); background: rgba(255, 255, 255, 0.07); }
  .spacer { flex: 1; }
  .pill { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px; background: rgba(255, 255, 255, 0.03); }
  .pill code { color: #c6ceff; font-size: 12px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none;
    box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.16); }

  .layout { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
    gap: 18px; align-items: start; padding: 28px 0 56px; }
  .rail { display: grid; gap: 14px; }
  .panel { border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel);
    padding: 20px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px -40px rgba(0, 0, 0, 0.9); }
  .panel h2 { margin: 0 0 14px; font-size: 15px; font-weight: 620; letter-spacing: -0.015em; }
  .hint { margin: 10px 0 0; font-size: 12.5px; color: var(--faint); line-height: 1.55; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

  form.create { display: grid; gap: 10px; margin-top: 14px; }
  label { font-size: 12px; color: var(--muted); }
  .field { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-strong);
    background: rgba(0, 0, 0, 0.35); color: var(--text); font: 13px/1.4 var(--mono); }
  .field:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 40px; padding: 0 14px; border-radius: 11px; border: 1px solid transparent;
    font: 600 13px/1 var(--font); color: #0a0d16; cursor: pointer;
    background: linear-gradient(135deg, #aab4ff, #7c8cff 45%, #22d3ee); }
  .btn:hover { filter: brightness(1.06); }
  .btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; filter: none; }
  .btn-ghost { background: rgba(255, 255, 255, 0.04); color: var(--text); border-color: var(--border-strong); }
  .btn-danger { background: rgba(255, 122, 144, 0.14); color: var(--danger); border-color: rgba(255, 122, 144, 0.35); }

  .sandbox-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .sandbox-list a { display: grid; gap: 2px; padding: 10px 12px; border-radius: 11px; color: var(--text); }
  .sandbox-list a:hover { background: rgba(255, 255, 255, 0.04); }
  .sandbox-list .is-selected a { background: rgba(124, 140, 255, 0.14); box-shadow: inset 0 0 0 1px rgba(124, 140, 255, 0.35); }
  .repo-name { font: 13px/1.4 var(--mono); overflow-wrap: anywhere; }
  .repo-meta { font-size: 11.5px; color: var(--muted); }

  .detail { border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel);
    padding: 24px; min-height: 320px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 30px 70px -50px rgba(0, 0, 0, 0.95); }
  .detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .crumb { margin: 0; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
  .detail-head h1 { margin: 4px 0 0; font-size: 22px; letter-spacing: -0.02em; font-weight: 640; overflow-wrap: anywhere; }
  .phase-pill { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600;
    border-radius: 999px; padding: 5px 11px; border: 1px solid var(--border-strong); color: var(--text-secondary); }
  .phase-pill[data-phase="ready"] { color: var(--success); border-color: rgba(74, 222, 128, 0.35); }
  .phase-pill[data-phase="failed"] { color: var(--danger); border-color: rgba(255, 122, 144, 0.4); }
  .phase-pill[data-phase="stopped"] { color: var(--text-muted); }
  .notice { margin: 12px 0 0; color: var(--warning); font-size: 13px; }
  .detail-empty { padding: 40px 8px; }
  .detail-empty h2 { margin: 0 0 8px; font-size: 18px; font-weight: 620; }
  .detail-empty p { margin: 0; color: var(--muted); max-width: 46ch; }

  .timeline { list-style: none; margin: 20px 0 22px; padding: 0; display: grid; gap: 0; }
  .step { position: relative; display: grid; grid-template-columns: 26px minmax(0, 1fr); align-items: baseline;
    gap: 10px; padding: 7px 0 7px 0; font-size: 13px; }
  .step::before { content: ""; position: absolute; left: 8px; top: 0; bottom: 0; width: 1px; background: var(--border); }
  .step:first-child::before { top: 50%; }
  .step:last-child::before { bottom: 50%; }
  .marker { position: relative; z-index: 1; display: grid; place-items: center; width: 18px; height: 18px;
    border-radius: 50%; font-size: 10px; background: var(--surface-raised);
    box-shadow: inset 0 0 0 1px var(--border-strong); color: var(--text-muted); }
  .step[data-state="done"] .marker { color: var(--success); box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.4); }
  .step[data-state="failed"] .marker { color: var(--danger); box-shadow: inset 0 0 0 1px rgba(255, 122, 144, 0.45); }
  .step[data-state="active"] .marker { color: var(--accent); box-shadow: inset 0 0 0 1px rgba(124, 140, 255, 0.55);
    animation: pulse 1.4s ease-in-out infinite; }
  .step[data-state="pending"] .step-label { color: var(--faint); }
  .step-label { color: var(--text-secondary); }
  .step[data-state="active"] .step-label { color: var(--text); font-weight: 560; }
  .step[data-state="failed"] .step-label { color: var(--danger); }
  .step-detail { grid-column: 2; color: var(--faint); font-size: 12px; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

  .preview { margin-top: 6px; }
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .preview-head h2 { margin: 0; font-size: 14px; font-weight: 620; }
  .frame { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: #05070c; aspect-ratio: 16 / 10; }
  .frame iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
  .frame-empty { display: grid; place-items: center; padding: 24px; background: rgba(0, 0, 0, 0.3); }
  .frame-empty p { margin: 0; color: var(--faint); font-size: 13px; text-align: center; }
  .share-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
  .share-field { flex: 1 1 240px; min-width: 0; padding: 9px 12px; border-radius: 10px;
    border: 1px solid var(--border); background: rgba(0, 0, 0, 0.35); color: var(--text-secondary); font: 12px/1.4 var(--mono); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 18px; }
  .logs { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 12px; }
  .logs summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .logs pre { max-height: 240px; overflow: auto; margin: 10px 0 0; padding: 12px;
    border-radius: 12px; border: 1px solid var(--border); background: rgba(0, 0, 0, 0.35);
    font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }

  .sponsored-ad { border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;
    background: linear-gradient(160deg, rgba(34, 211, 238, 0.1), rgba(124, 140, 255, 0.06) 55%, rgba(255, 255, 255, 0.02)); }
  .sponsored-ad .sponsored-label { display: inline-block; font-size: 10px; font-weight: 650; letter-spacing: 0.1em;
    text-transform: uppercase; color: #bfe9f5; border: 1px solid rgba(34, 211, 238, 0.35); border-radius: 999px;
    padding: 2px 8px; margin-bottom: 8px; background: rgba(34, 211, 238, 0.1); }
  .sponsored-ad strong { display: block; font-size: 14px; font-weight: 600; }
  .sponsored-ad p { margin: 5px 0 8px; font-size: 12.5px; color: var(--muted); line-height: 1.55; }
  .sponsored-ad a { font-size: 12.5px; font-weight: 600; color: #7fe6f7; }

  @media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } .topnav { margin-left: 0; } }
  @media (max-width: 560px) {
    .wrap { width: min(1180px, 100% - 28px); }
    .topbar-inner { height: auto; min-height: 60px; padding: 10px 0; }
    .detail { padding: 18px; }
    .panel { padding: 16px; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition-duration: 0.001ms !important; }
    .step[data-state="active"] .marker { animation: none; }
  }
</style>
</head>
<body data-sandbox="${selectedId === undefined ? "" : escapeHtml(selectedId)}">
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="/" aria-label="freebuff cloud home">
      <span class="brand-mark">${BRAND_MARK}</span>
      <span class="brand-name">freebuff</span>
      <span class="brand-tag">cloud</span>
    </a>
    <nav class="topnav" aria-label="Sections">
      <a href="/">Overview</a>
      <a href="/sandboxes" aria-current="page">Sandboxes</a>
    </nav>
    <span class="spacer"></span>
    <span class="pill"><span class="dot"></span> provider <code>${escapeHtml(options.providerName)}</code></span>
  </div>
</header>

<main class="wrap layout">
  <section class="rail" aria-label="Repositories and sandboxes">
    <div class="panel">
      <h2>Repositories</h2>
      ${github}
      <form class="create" id="create-form">
        <label for="repo-url">Repository URL</label>
        <input class="field" id="repo-url" name="repoUrl" type="url" required
          placeholder="https://github.com/owner/repo" autocomplete="off" />
        <label for="repo-ref">Branch or tag (optional)</label>
        <input class="field" id="repo-ref" name="ref" type="text" placeholder="main" autocomplete="off" />
        <button class="btn" type="submit">Start sandbox</button>
        <p class="hint" id="form-status" role="status" aria-live="polite">${escapeHtml(options.previewHint)}</p>
      </form>
    </div>
    <div class="panel">
      <h2>Sandboxes</h2>
      ${sandboxListHtml(options.sandboxes, selectedId)}
    </div>
    ${options.adHtml ?? ""}
  </section>

  <section class="detail" id="detail" aria-label="Sandbox detail">
    ${detailHtml(options.selected, options.shareUrl, options.notice)}
  </section>
</main>

<script>
(function () {
  var body = document.body;
  var sandboxId = body.getAttribute("data-sandbox") || "";

  function readJson(response) {
    return response.json().then(function (body) {
      return { ok: response.ok, body: body };
    });
  }

  var form = document.getElementById("create-form");
  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var repo = document.getElementById("repo-url");
      var ref = document.getElementById("repo-ref");
      var status = document.getElementById("form-status");
      if (!repo || !status) { return; }
      status.textContent = "Provisioning sandbox…";
      fetch("/api/sandboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.value.trim(), ref: ref && ref.value.trim() ? ref.value.trim() : undefined })
      })
        .then(readJson)
        .then(function (result) {
          if (!result.ok) {
            status.textContent = (result.body && result.body.message) || "Could not start the sandbox.";
            return;
          }
          location.href = "/sandboxes?sandbox=" + encodeURIComponent(String(result.body.sandbox.sandboxId));
        })
        .catch(function () { status.textContent = "Network error. Try again."; });
    });
  }

  var shareButton = document.querySelector("[data-share]");
  if (shareButton) {
    shareButton.addEventListener("click", function () {
      var target = shareButton.getAttribute("data-share");
      var out = document.getElementById("share-status");
      var field = document.getElementById("share-url");
      fetch(target)
        .then(readJson)
        .then(function (result) {
          var url = result.body && result.body.url;
          if (!result.ok || !url) { throw new Error("share failed"); }
          if (field) { field.value = url; }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).catch(function () { return undefined; });
          }
          if (out) { out.textContent = "Shareable link ready: " + url; }
        })
        .catch(function () { if (out) { out.textContent = "Could not create a share link."; } });
    });
  }

  var buttons = document.querySelectorAll("[data-action]");
  Array.prototype.forEach.call(buttons, function (button) {
    button.addEventListener("click", function () {
      var action = button.getAttribute("data-action");
      var out = document.getElementById("action-status");
      if (!sandboxId) { return; }
      var method = action === "remove" ? "DELETE" : "POST";
      var url = "/api/sandboxes/" + encodeURIComponent(sandboxId) + (action === "remove" ? "" : "/stop");
      if (out) { out.textContent = action === "remove" ? "Deleting…" : "Stopping…"; }
      fetch(url, { method: method })
        .then(function () {
          location.href = action === "remove" ? "/sandboxes" : "/sandboxes?sandbox=" + encodeURIComponent(sandboxId);
        })
        .catch(function () { if (out) { out.textContent = "The API did not answer. Try again."; } });
    });
  });

  var timeline = document.querySelector(".timeline");
  var settled = ["ready", "failed", "stopped"];
  if (timeline && sandboxId && settled.indexOf(timeline.getAttribute("data-phase") || "") === -1) {
    var phase = timeline.getAttribute("data-phase");
    setInterval(function () {
      fetch("/api/sandboxes/" + encodeURIComponent(sandboxId))
        .then(readJson)
        .then(function (result) {
          if (result.ok && result.body.phase !== phase) { location.reload(); }
        })
        .catch(function () { return undefined; });
    }, 3000);
  }
})();
</script>
</body>
</html>`;
};
