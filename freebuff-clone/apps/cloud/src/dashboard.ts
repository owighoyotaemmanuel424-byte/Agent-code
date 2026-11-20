const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
<title>freebuff cloud</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
  main { max-width: 780px; margin: 0 auto; padding: 48px 24px; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  p { color: #9da7b3; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; overflow: auto; }
  .pill { display: inline-block; border: 1px solid #30363d; border-radius: 999px; padding: 2px 10px; font-size: 12px; color: #9da7b3; }
  a { color: #58a6ff; }
  .sponsored-ad { margin-top: 22px; border: 1px dashed #30363d; border-radius: 10px; padding: 14px 16px; }
  .sponsored-ad .sponsored-label { display: inline-block; font-size: 11px; letter-spacing: .08em;
    text-transform: uppercase; color: #9da7b3; border: 1px solid #30363d; border-radius: 999px;
    padding: 1px 8px; margin-bottom: 8px; }
  .sponsored-ad strong { display: block; }
  .sponsored-ad p { margin: 4px 0; }
</style>
</head>
<body>
<main>
  <h1>freebuff cloud sandboxes</h1>
  <p class="pill">provider: ${escapeHtml(options.providerName)}</p>
  <p>Connect a repository, clone it into an isolated workspace, install it and get a preview URL.</p>
  <h2>API</h2>
  <pre>POST /api/sandboxes        {"repoUrl":"https://github.com/owner/repo"}
GET  /api/sandboxes
GET  /api/sandboxes/:id
GET  /api/sandboxes/:id/logs
GET  /api/sandboxes/:id/share
POST /api/sandboxes/:id/stop
DELETE /api/sandboxes/:id</pre>
  <p>${escapeHtml(options.previewHint)}</p>
  ${options.adHtml ?? ""}
  <p>Status: <a href="/healthz">/healthz</a></p>
</main>
</body>
</html>`;
