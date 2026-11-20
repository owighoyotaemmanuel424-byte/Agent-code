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

interface Endpoint {
  readonly method: string;
  readonly path: string;
  readonly description: string;
}

const ENDPOINTS: readonly Endpoint[] = [
  { method: "POST", path: "/api/sandboxes", description: "Clone a repository into a new sandbox" },
  { method: "GET", path: "/api/sandboxes", description: "List sandboxes for this tenant" },
  { method: "GET", path: "/api/sandboxes/:id", description: "Read status and preview URL" },
  { method: "GET", path: "/api/sandboxes/:id/logs", description: "Tail the install and dev-server logs" },
  { method: "GET", path: "/api/sandboxes/:id/share", description: "Mint a shareable preview link" },
  { method: "POST", path: "/api/sandboxes/:id/stop", description: "Stop the sandbox process" },
  { method: "DELETE", path: "/api/sandboxes/:id", description: "Remove the sandbox and its workspace" },
];

/**
 * Server-rendered landing page. It deliberately shows no tenant data: sandbox
 * listings are served by the authenticated JSON API only.
 */
export const dashboardHtml = (options: {
  readonly providerName: string;
  readonly previewHint: string;
  readonly adHtml?: string;
}): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>freebuff cloud · sandboxes</title>
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
      radial-gradient(760px 460px at 92% -6%, rgba(34, 211, 238, 0.15), transparent 62%),
      radial-gradient(900px 600px at 50% 115%, rgba(168, 85, 247, 0.12), transparent 70%);
  }
  .wrap { width: min(1080px, 100% - 44px); margin-inline: auto; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: #b8c1ff; }
  code, pre { font-family: var(--mono); }

  .site-header {
    position: sticky; top: 0; z-index: 20;
    border-bottom: 1px solid var(--border);
    background: rgba(7, 9, 15, 0.72);
    backdrop-filter: blur(18px) saturate(140%);
  }
  .header-inner { display: flex; align-items: center; gap: 12px; height: 64px; }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); }
  .brand:hover { color: var(--text); }
  .brand-mark {
    display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: #fff;
    background: linear-gradient(140deg, #7c8cff, #22d3ee 65%, #a855f7);
    box-shadow: 0 6px 18px rgba(124, 140, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .brand-mark svg { width: 18px; height: 18px; }
  .brand-name { font-weight: 650; letter-spacing: -0.02em; font-size: 16px; }
  .brand-tag {
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px;
  }
  .header-spacer { flex: 1; }
  .pill {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 12.5px; color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px;
    padding: 6px 12px; background: rgba(255, 255, 255, 0.03); white-space: nowrap;
  }
  .pill code { color: #c6ceff; font-size: 12px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok);
    box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.16); flex: none; }

  .hero { padding: clamp(48px, 7vw, 82px) 0 0; max-width: 720px; }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 9px;
    font-size: 12.5px; font-weight: 550; color: #c3cbe4;
    border: 1px solid var(--border-strong); border-radius: 999px; padding: 6px 14px 6px 11px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
  }
  h1 {
    margin: 20px 0 14px; font-size: clamp(34px, 5.2vw, 50px); line-height: 1.06;
    letter-spacing: -0.035em; font-weight: 660;
  }
  .grad {
    background: linear-gradient(105deg, #c7d2fe 5%, #7c8cff 42%, #22d3ee 88%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .lead { margin: 0; font-size: 16.5px; color: var(--muted); max-width: 58ch; }

  .grid {
    display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
    gap: 18px; align-items: start; padding: 40px 0 0;
  }
  .panel {
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--panel); padding: 22px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px -40px rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(12px);
  }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .panel-head h2 { margin: 0; font-size: 15.5px; font-weight: 620; letter-spacing: -0.015em; }
  .panel-sub { margin: 4px 0 16px; font-size: 13px; color: var(--faint); }

  .endpoints { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .endpoint {
    display: grid; grid-template-columns: 66px minmax(0, 1fr); gap: 12px;
    align-items: baseline; padding: 11px 10px; border-radius: 11px;
    transition: background 0.15s ease;
  }
  .endpoint:hover { background: rgba(255, 255, 255, 0.035); }
  .method {
    font: 600 10.5px/1 var(--mono); letter-spacing: 0.06em; text-align: center;
    padding: 5px 0; border-radius: 6px;
    color: #bfe9f5; background: rgba(34, 211, 238, 0.12); border: 1px solid rgba(34, 211, 238, 0.28);
  }
  .method.is-write { color: #ffd9b0; background: rgba(240, 180, 41, 0.12); border-color: rgba(240, 180, 41, 0.3); }
  .method.is-delete { color: #ffd0d8; background: rgba(255, 122, 144, 0.12); border-color: rgba(255, 122, 144, 0.3); }
  .endpoint-body { min-width: 0; }
  .endpoint-path { display: block; font: 13px/1.5 var(--mono); color: var(--text); overflow-wrap: anywhere; }
  .endpoint-desc { font-size: 12.5px; color: var(--faint); }

  pre.snippet {
    margin: 16px 0 0; padding: 14px 16px; overflow: auto;
    font-size: 12.5px; line-height: 1.6; color: #cfd6e6;
    border: 1px solid var(--border); border-radius: 12px; background: rgba(0, 0, 0, 0.35);
  }
  pre.snippet .tok { color: #7fe6f7; }

  .aside-stack { display: grid; gap: 14px; }
  .stat {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 0; border-top: 1px solid var(--border); font-size: 13px;
  }
  .stat:first-child { border-top: 0; }
  .stat dt { color: var(--faint); margin: 0; }
  .stat dd { margin: 0; color: var(--text); font-weight: 550; text-align: right;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 62%; }
  .stat dd code { color: #c6ceff; font-size: 12px; }
  .hint { margin: 12px 0 0; font-size: 12.5px; color: var(--faint); line-height: 1.55; }
  .health { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; }

  .sponsored-ad {
    border: 1px solid var(--border); border-radius: var(--radius); padding: 18px;
    background: linear-gradient(160deg, rgba(34, 211, 238, 0.1), rgba(124, 140, 255, 0.06) 55%, rgba(255, 255, 255, 0.02));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  .sponsored-ad .sponsored-label {
    display: inline-block; font-size: 10px; font-weight: 650; letter-spacing: 0.1em;
    text-transform: uppercase; color: #bfe9f5;
    border: 1px solid rgba(34, 211, 238, 0.35); border-radius: 999px;
    padding: 2px 8px; margin-bottom: 10px; background: rgba(34, 211, 238, 0.1);
  }
  .sponsored-ad strong { display: block; font-size: 14.5px; font-weight: 600; color: var(--text); }
  .sponsored-ad p { margin: 5px 0 10px; font-size: 12.8px; color: var(--muted); line-height: 1.55; }
  .sponsored-ad a { font-size: 12.5px; font-weight: 600; color: #7fe6f7; }
  .sponsored-ad a::after { content: " ↗"; }

  .site-footer { margin-top: 56px; border-top: 1px solid var(--border); }
  .footer-inner {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    flex-wrap: wrap; padding: 24px 0 32px; font-size: 12.5px; color: var(--faint);
  }
  .footer-links { display: flex; gap: 16px; }
  .footer-links a { color: var(--faint); }
  .footer-links a:hover { color: var(--text); }

  @media (max-width: 880px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 560px) {
    .wrap { width: min(1080px, 100% - 32px); }
    .brand-tag { display: none; }
    .panel { padding: 18px; }
    .endpoint { grid-template-columns: 58px minmax(0, 1fr); }
    .header-inner { height: auto; min-height: 60px; flex-wrap: wrap; gap: 8px; padding: 10px 0; }
    .header-spacer { display: none; }
    .pill { margin-left: auto; max-width: 100%; white-space: normal; font-size: 11.5px; }
    .pill code { overflow-wrap: anywhere; }
    pre.snippet { white-space: pre-wrap; overflow-wrap: anywhere; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.001ms !important; } }
</style>
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="freebuff cloud home">
      <span class="brand-mark">${BRAND_MARK}</span>
      <span class="brand-name">freebuff</span>
      <span class="brand-tag">cloud</span>
    </a>
    <span class="header-spacer"></span>
    <span class="pill" title="Active sandbox provider">
      <span class="dot"></span> provider <code>${escapeHtml(options.providerName)}</code>
    </span>
  </div>
</header>

<main class="wrap">
  <section class="hero">
    <span class="eyebrow"><span class="dot"></span> Cloud sandboxes</span>
    <h1>Clone a repo.<br /><span class="grad">Get a preview URL.</span></h1>
    <p class="lead">freebuff cloud sandboxes run an isolated workspace per repository: clone, install, start the dev server and share a live preview.</p>
  </section>

  <div class="grid">
    <section class="panel" aria-labelledby="api-title">
      <div class="panel-head">
        <h2 id="api-title">API</h2>
        <span class="pill" style="font-size:11.5px;padding:3px 10px">JSON</span>
      </div>
      <p class="panel-sub">Authenticated sandbox operations. Every handler is Request → Response.</p>
      <ul class="endpoints">
        ${ENDPOINTS.map(
          (endpoint) => `<li class="endpoint">
          <span class="method${endpoint.method === "DELETE" ? " is-delete" : endpoint.method === "POST" ? " is-write" : ""}">${endpoint.method}</span>
          <span class="endpoint-body">
            <span class="endpoint-path">${escapeHtml(endpoint.path)}</span>
            <span class="endpoint-desc">${escapeHtml(endpoint.description)}</span>
          </span>
        </li>`,
        ).join("\n        ")}
      </ul>
      <pre class="snippet"><span class="tok">$</span> curl -s localhost:3001/api/sandboxes \\
    -H 'content-type: application/json' \\
    -d '{"repoUrl":"https://github.com/owner/repo"}'</pre>
    </section>

    <aside class="aside-stack">
      <div class="panel">
        <div class="panel-head"><h2>Workspace</h2></div>
        <dl style="margin:0">
          <div class="stat"><dt>Provider</dt><dd><code>${escapeHtml(options.providerName)}</code></dd></div>
          <div class="stat"><dt>Isolation</dt><dd>Per-sandbox network</dd></div>
          <div class="stat"><dt>Preview</dt><dd>Local host</dd></div>
        </dl>
        <p class="hint">${escapeHtml(options.previewHint)}</p>
        <p class="hint" style="margin-top:8px">
          <a class="health" href="/healthz"><span class="dot"></span> Health check</a>
        </p>
      </div>
      ${options.adHtml ?? ""}
    </aside>
  </div>
</main>

<footer class="site-footer">
  <div class="wrap footer-inner">
    <span>freebuff cloud · isolated workspaces, one call away</span>
    <span class="footer-links">
      <a href="/healthz">Status</a>
      <a href="/api/sandboxes">Sandboxes</a>
      <a href="/">Builder</a>
    </span>
  </div>
</footer>
</body>
</html>`;
