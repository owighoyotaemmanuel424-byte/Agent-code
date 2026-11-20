import type { FreebuffClient } from "@freebuff/sdk";
import type { AdDecision, QuotaSnapshot } from "@freebuff/shared";
import { AppError } from "@freebuff/shared";
import { sponsoredAdHtml } from "@freebuff/ads";

export interface DesktopAppOptions {
  readonly client: FreebuffClient;
  readonly sessionId?: string;
  readonly platformUrl: string;
  readonly now?: () => Date;
}

interface DesktopState {
  readonly email: string;
  readonly plan: string;
  readonly quota: QuotaSnapshot;
  readonly ad: AdDecision | null;
  readonly apps: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly url: string;
  }[];
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const statusFor = (error: AppError): number => {
  switch (error.code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "validation_failed":
      return 422;
    case "verification_required":
      return 403;
    case "quota_exceeded":
      return 429;
    default:
      return 500;
  }
};

const hours = (seconds: number): string => (seconds / 3600).toFixed(2);

const initials = (value: string): string => {
  const handle = value.split("@")[0] ?? value;
  const parts = handle.split(/[.\-_]+/).filter((part) => part.length > 0);
  const first = parts[0]?.charAt(0) ?? handle.charAt(0);
  const second = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) : handle.charAt(1);
  return `${first ?? "?"}${second ?? ""}`.toUpperCase() || "?";
};

const page = (options: {
  readonly state: DesktopState;
  readonly platformUrl: string;
}): string => {
  const { state } = options;
  const quotaLimitSeconds = state.quota.hoursPerDay * 3600;
  const quotaPercent =
    quotaLimitSeconds <= 0
      ? 0
      : Math.min(
          100,
          Math.max(0, (state.quota.consumedSecondsToday / quotaLimitSeconds) * 100),
        );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>freebuff desktop${state.apps.length === 0 ? "" : ` · ${state.apps.length} apps`}</title>
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
  }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
    font: 14.5px/1.6 var(--font); -webkit-font-smoothing: antialiased;
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

  /* app window frame */
  .shell {
    display: grid; grid-template-columns: 264px minmax(0, 1fr);
    min-height: 100vh;
  }

  /* ---------- sidebar ---------- */
  aside.sidebar {
    display: flex; flex-direction: column; gap: 18px;
    padding: 20px 18px 22px;
    border-right: 1px solid var(--border);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
    backdrop-filter: blur(16px);
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); }
  .brand:hover { color: var(--text); }
  .brand-mark {
    display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: #fff;
    background: linear-gradient(140deg, #7c8cff, #22d3ee 65%, #a855f7);
    box-shadow: 0 6px 16px rgba(124, 140, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .brand-mark svg { width: 17px; height: 17px; }
  .brand-name { font-weight: 650; letter-spacing: -0.02em; font-size: 15.5px; }
  .brand-tag {
    font-size: 10px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 7px;
  }

  .account {
    display: flex; align-items: center; gap: 11px;
    border: 1px solid var(--border); border-radius: 14px; padding: 11px 12px;
    background: rgba(255, 255, 255, 0.03);
  }
  .avatar {
    display: grid; place-items: center; flex: none;
    width: 34px; height: 34px; border-radius: 10px;
    font-size: 13px; font-weight: 650; color: #0a0d16;
    background: linear-gradient(140deg, #aab4ff, #22d3ee);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }
  .account-body { min-width: 0; }
  .account-email {
    display: block; font-size: 12.5px; font-weight: 550; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .account-plan { font-size: 11.5px; color: var(--faint); text-transform: capitalize; }

  .side-section { display: grid; gap: 8px; }
  .side-label {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    font-size: 10.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--faint);
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
  .sidebar-footer code { color: var(--muted); }

  .sponsored-ad {
    border: 1px solid rgba(34, 211, 238, 0.24); border-radius: 14px; padding: 14px;
    background: linear-gradient(160deg, rgba(34, 211, 238, 0.1), rgba(124, 140, 255, 0.06) 60%, rgba(255, 255, 255, 0.02));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  .sponsored-ad .sponsored-label {
    display: inline-block; font-size: 9.5px; font-weight: 650; letter-spacing: 0.1em;
    text-transform: uppercase; color: #bfe9f5;
    border: 1px solid rgba(34, 211, 238, 0.35); border-radius: 999px;
    padding: 2px 7px; margin-bottom: 8px; background: rgba(34, 211, 238, 0.1);
  }
  .sponsored-ad strong { display: block; font-size: 12.8px; font-weight: 600; color: var(--text); }
  .sponsored-ad p { margin: 4px 0 8px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
  .sponsored-ad a { font-size: 11.5px; font-weight: 600; color: #7fe6f7; }
  .sponsored-ad a::after { content: " ↗"; }

  /* ---------- main ---------- */
  main { padding: 26px clamp(20px, 4vw, 40px) 48px; min-width: 0; }
  .page-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin-bottom: 22px;
  }
  h1 { margin: 0; font-size: clamp(24px, 3vw, 32px); letter-spacing: -0.03em; font-weight: 650; line-height: 1.15; }
  .grad {
    background: linear-gradient(105deg, #c7d2fe 5%, #7c8cff 42%, #22d3ee 88%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .page-sub { margin: 6px 0 0; color: var(--muted); font-size: 13.5px; max-width: 62ch; }
  .platform-chip {
    display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
    font-size: 11.5px; color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px;
    background: rgba(255, 255, 255, 0.03);
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok);
    box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.16); flex: none; }

  .panel {
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--panel); padding: 20px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px -42px rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(12px);
  }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .panel-head h2 { margin: 0; font-size: 15px; font-weight: 620; letter-spacing: -0.015em; }
  .panel-head .count { font-size: 11.5px; color: var(--faint); }

  .composer { border: 1px solid var(--border-strong); border-radius: 16px; overflow: hidden;
    background: rgba(0, 0, 0, 0.3); transition: border-color 0.2s ease, box-shadow 0.2s ease; }
  .composer:focus-within { border-color: rgba(124, 140, 255, 0.6);
    box-shadow: 0 0 0 4px rgba(124, 140, 255, 0.13); }
  textarea {
    display: block; width: 100%; min-height: 116px; resize: vertical;
    padding: 16px 16px 6px; color: inherit; background: transparent; border: 0; outline: none;
    font: 15px/1.6 var(--font);
  }
  textarea::placeholder { color: var(--faint); }
  .composer-foot { display: flex; align-items: center; gap: 12px; padding: 10px 12px 12px 16px; }
  .hint { font-size: 11.5px; color: var(--faint); }
  .spacer { flex: 1; }
  button {
    font: inherit; font-weight: 600; letter-spacing: -0.01em;
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 18px; border: 0; border-radius: 11px; color: #080b14; cursor: pointer;
    background: linear-gradient(135deg, #aab4ff, #7c8cff 45%, #22d3ee);
    box-shadow: 0 10px 24px -12px rgba(124, 140, 255, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.5);
    transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease;
  }
  button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
  button:disabled { cursor: progress; opacity: 0.6; }
  button .spinner {
    width: 13px; height: 13px; border-radius: 50%; display: none;
    border: 2px solid rgba(8, 11, 20, 0.35); border-top-color: #080b14;
    animation: spin 0.7s linear infinite;
  }
  button[aria-busy="true"] .spinner { display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  #status:empty { display: none; }
  #status { margin-top: 14px; }
  .notice {
    display: flex; gap: 11px; align-items: flex-start;
    border: 1px solid var(--border); border-radius: 13px; padding: 13px 15px;
    background: rgba(255, 255, 255, 0.03); font-size: 13px; color: var(--muted);
  }
  .notice.error { border-color: rgba(255, 122, 144, 0.35); background: rgba(255, 122, 144, 0.08); color: #ffd0d8; }
  .notice.ok { border-color: rgba(74, 222, 128, 0.32); background: rgba(74, 222, 128, 0.07); color: #c8f6d8; }
  .notice strong { display: block; color: var(--text); font-weight: 600; }
  .notice.error strong, .notice.ok strong { color: inherit; }
  .notice .dot.is-off { background: #f0b429; box-shadow: 0 0 0 3px rgba(240, 180, 41, 0.16); }
  .timeline { list-style: none; margin: 8px 0 0; padding: 0; }
  .timeline li { position: relative; display: flex; gap: 10px; padding: 5px 0; font-size: 12.5px; color: var(--muted); }
  .timeline li::before {
    content: ""; width: 6px; height: 6px; margin-top: 7px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 0 3px rgba(124, 140, 255, 0.15); flex: none;
  }
  .timeline li.is-done::before { background: var(--ok); box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.15); }
  .timeline li.is-failed::before { background: var(--danger); box-shadow: 0 0 0 3px rgba(255, 122, 144, 0.15); }
  .timeline .step { color: var(--text); font-weight: 550; }

  .apps { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
  .app-card {
    display: flex; align-items: center; gap: 12px;
    border: 1px solid var(--border); border-radius: 13px; padding: 12px 14px;
    background: rgba(255, 255, 255, 0.02);
    transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
  }
  .app-card:hover { border-color: rgba(124, 140, 255, 0.4); background: rgba(124, 140, 255, 0.06); transform: translateY(-1px); }
  .app-avatar {
    display: grid; place-items: center; flex: none; width: 34px; height: 34px;
    border-radius: 10px; font-size: 13px; font-weight: 650; color: #0a0d16;
    background: linear-gradient(140deg, #aab4ff, #22d3ee);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }
  .app-body { min-width: 0; flex: 1; }
  .app-name { display: block; font-size: 13.5px; font-weight: 560; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .app-name:hover { color: #b8c1ff; }
  .app-meta { margin: 1px 0 0; font-size: 11.5px; color: var(--faint); }
  .empty { padding: 22px 8px; text-align: center; color: var(--faint); font-size: 12.5px;
    border: 1px dashed var(--border); border-radius: 13px; }

  @media (max-width: 860px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    aside.sidebar { position: static; height: auto; flex-direction: row; flex-wrap: wrap;
      align-items: center; border-right: 0; border-bottom: 1px solid var(--border); gap: 14px; }
    .side-section, .sidebar-footer { flex: 1 1 220px; }
    .sidebar-footer { margin-top: 0; }
    aside.sidebar .sponsored-ad { flex: 1 1 260px; }
    main { padding: 22px 18px 40px; }
  }
  @media (max-width: 520px) {
    .composer-foot button { width: 100%; justify-content: center; }
    .hint { display: none; }
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
      <div class="side-label"><span>Session</span></div>
      <div><span class="badge"><span class="dot"></span>${escapeHtml(state.plan)}</span></div>
    </div>

    ${state.ad === null ? "" : sponsoredAdHtml(state.ad.ad)}

    <div class="sidebar-footer">
      Local shell over the platform API.<br />
      <code>${escapeHtml(options.platformUrl)}</code>
    </div>
  </aside>

  <main>
    <div class="page-head">
      <div>
        <h1>Build an <span class="grad">app</span></h1>
        <p class="page-sub">One prompt. The same runtime, quota and account as the CLI — nothing is charged until you publish.</p>
      </div>
      <span class="platform-chip"><span class="dot"></span> platform connected</span>
    </div>

    <form id="build" class="panel" style="padding:16px">
      <div class="composer">
        <label for="prompt" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Describe the app you want</label>
        <textarea id="prompt" placeholder="A reading list with notes, tags and a finished flag." spellcheck="false"></textarea>
        <div class="composer-foot">
          <span class="hint">Ctrl + Enter to build</span>
          <span class="spacer"></span>
          <button id="submit" type="submit"><span class="spinner" aria-hidden="true"></span><span id="submit-label">Build app</span></button>
        </div>
      </div>
      <div id="status" role="status" aria-live="polite"></div>
    </form>

    <section class="panel" style="margin-top:18px" aria-labelledby="apps-title">
      <div class="panel-head">
        <h2 id="apps-title">Your apps</h2>
        <span class="count">${state.apps.length === 1 ? "1 app" : `${String(state.apps.length)} apps`}</span>
      </div>
      <ul class="apps" id="apps">
        ${
          state.apps.length === 0
            ? `<li class="empty">No apps yet — describe one above to get started.</li>`
            : state.apps
                .map(
                  (app) => `<li class="app-card">
          <span class="app-avatar" aria-hidden="true">${escapeHtml(initials(app.name))}</span>
          <span class="app-body">
            <a class="app-name" href="${escapeHtml(app.url)}">${escapeHtml(app.name)}</a>
            <p class="app-meta">${escapeHtml(app.status)} · ${escapeHtml(app.url)}</p>
          </span>
          <span class="badge">${escapeHtml(app.status)}</span>
        </li>`,
                )
                .join("\n        ")
        }
      </ul>
    </section>
  </main>
</div>
<script>
(function () {
  var form = document.getElementById('build');
  var prompt = document.getElementById('prompt');
  var submit = document.getElementById('submit');
  var submitLabel = document.getElementById('submit-label');
  var status = document.getElementById('status');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.setAttribute('aria-busy', busy ? 'true' : 'false');
    submitLabel.textContent = busy ? 'Building…' : 'Build app';
  }

  function notice(kind, title, message) {
    status.textContent = '';
    var box = el('div', 'notice ' + kind);
    box.appendChild(el('span', 'dot' + (kind === 'error' ? ' is-off' : '')));
    var copy = el('div');
    copy.appendChild(el('strong', '', title));
    if (message) copy.appendChild(el('div', '', message));
    box.appendChild(copy);
    status.appendChild(box);
    return copy;
  }

  function renderTimeline(timeline) {
    var items = el('ul', 'timeline');
    timeline.forEach(function (step) {
      var state = String(step.status || '').toLowerCase();
      var cls = state.indexOf('fail') >= 0 || state.indexOf('error') >= 0
        ? ' is-failed'
        : state === 'done' || state === 'ok' || state === 'complete' ? ' is-done' : '';
      var row = el('li', cls);
      var text = el('span');
      text.appendChild(el('span', 'step', step.step));
      text.appendChild(el('span', '', ' — ' + step.status + (step.detail ? ' · ' + step.detail : '')));
      row.appendChild(text);
      items.appendChild(row);
    });
    return items;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!prompt.value.trim() || submit.disabled) return;
    setBusy(true);
    notice('', 'Building your app', 'Designing, scaffolding and deploying through the platform API.');
    fetch('/api/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.value })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.message || 'Build failed');
        return body;
      });
    }).then(function (body) {
      var copy = notice('ok', 'Deployed ' + body.app.name, 'Your app is live.');
      if (body.timeline && body.timeline.length) copy.appendChild(renderTimeline(body.timeline));
      var link = el('a', '', 'Open app →');
      link.href = body.url;
      link.style.display = 'inline-block';
      link.style.marginTop = '8px';
      copy.appendChild(link);
      prompt.value = '';
    }).catch(function (error) {
      notice('error', 'Build failed', error.message);
    }).finally(function () { setBusy(false); });
  });

  prompt.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
})();
</script>
</body>
</html>`;
};

/**
 * Desktop surface: a local shell over the same platform API. Accounts, quota,
 * ads and apps are server-authoritative; the shell only renders them.
 */
export const createDesktopApp = (
  options: DesktopAppOptions,
): { readonly fetch: (request: Request) => Promise<Response> } => {
  const sessionId = options.sessionId ?? "desktop-local";

  const loadState = async (): Promise<DesktopState> => {
    const user = await options.client.me();
    const quota = await options.client.quota();
    const ad = await options.client.ads({
      slot: "desktop.sidebar",
      surface: "desktop",
      session: sessionId,
    });
    const apps = await options.client.listApps();
    return {
      email: user.email,
      plan: user.plan,
      quota: quota.snapshot,
      ad: ad.decision,
      apps: apps.map((app) => ({
        id: app.id,
        name:
          typeof app.spec["name"] === "string" ? app.spec["name"] : app.slug,
        status: app.status,
        url: app.url,
      })),
    };
  };

  return {
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/") {
          const state = await loadState();
          return new Response(
            page({ state, platformUrl: options.platformUrl }),
            {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
                "referrer-policy": "no-referrer",
              },
            },
          );
        }

        if (request.method === "GET" && url.pathname === "/api/state") {
          return json(200, await loadState());
        }

        if (request.method === "POST" && url.pathname === "/api/build") {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            throw new AppError({
              code: "validation_failed",
              message: "Request body must be valid JSON",
            });
          }
          const prompt =
            typeof body === "object" &&
            body !== null &&
            typeof (body as Record<string, unknown>)["prompt"] === "string"
              ? String((body as Record<string, unknown>)["prompt"])
              : "";
          const built = await options.client.buildApp(prompt);
          return json(201, {
            app: {
              id: built.app.id,
              name:
                typeof built.app.spec["name"] === "string"
                  ? built.app.spec["name"]
                  : built.app.slug,
              status: built.app.status,
            },
            url: built.url,
            timeline: built.timeline,
          });
        }

        return json(404, {
          error: "not_found",
          code: "not_found",
          message: "Unknown route",
          retryable: false,
        });
      } catch (error) {
        if (error instanceof AppError) {
          return json(statusFor(error), {
            error: error.code,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          });
        }
        return json(500, {
          error: "internal",
          code: "internal",
          message: "Unexpected error",
          retryable: false,
        });
      }
    },
  };
};
