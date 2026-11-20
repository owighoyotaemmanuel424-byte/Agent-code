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

const page = (options: {
  readonly state: DesktopState;
  readonly platformUrl: string;
}): string => {
  const { state } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>freebuff desktop</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; }
  .shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
  aside { border-right: 1px solid #30363d; padding: 20px 16px; background: #10151c; }
  main { padding: 28px 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .muted { color: #9da7b3; font-size: 13px; }
  .quota { margin-top: 20px; font-size: 13px; }
  textarea { width: 100%; min-height: 110px; padding: 12px; color: inherit; background: #161b22;
    border: 1px solid #30363d; border-radius: 8px; font: inherit; resize: vertical; }
  button { font: inherit; font-weight: 600; padding: 9px 16px; border: 0; border-radius: 8px;
    background: #2f81f7; color: #fff; cursor: pointer; margin-top: 10px; }
  button:disabled { opacity: .55; cursor: progress; }
  ul { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 8px; }
  li { border: 1px solid #21262d; border-radius: 8px; padding: 10px 12px; }
  a { color: #58a6ff; }
  .error { color: #f85149; }
  .ok { color: #3fb950; }
  .sponsored-ad { margin-top: 24px; border: 1px dashed #30363d; border-radius: 10px; padding: 12px; }
  .sponsored-ad .sponsored-label { display: inline-block; font-size: 10px; letter-spacing: .08em;
    text-transform: uppercase; color: #9da7b3; border: 1px solid #30363d; border-radius: 999px;
    padding: 1px 8px; margin-bottom: 6px; }
  .sponsored-ad strong { display: block; font-size: 13px; }
  .sponsored-ad p { margin: 4px 0; color: #9da7b3; font-size: 12px; }
</style>
</head>
<body>
<div class="shell">
  <aside>
    <h1>freebuff</h1>
    <p class="muted">${escapeHtml(state.email)}</p>
    <div class="quota">
      <div><strong>${escapeHtml(state.plan)}</strong> plan</div>
      <div class="muted">${hours(state.quota.consumedSecondsToday)}h of ${String(state.quota.hoursPerDay)}h today</div>
      <div class="muted">Resets ${escapeHtml(state.quota.resetsAt)}</div>
      <div class="muted">${state.quota.adsEnabled ? "Ads on free tier" : "No ads"}</div>
    </div>
    ${state.ad === null ? "" : sponsoredAdHtml(state.ad.ad)}
  </aside>
  <main>
    <h2>Build an app</h2>
    <p class="muted">Same runtime, quota and account as the CLI. Platform: ${escapeHtml(options.platformUrl)}</p>
    <form id="build">
      <textarea id="prompt" placeholder="A reading list with notes, tags and a finished flag."></textarea>
      <button id="submit" type="submit">Build app</button>
    </form>
    <div id="status"></div>
    <h2 style="margin-top:28px">Your apps</h2>
    <ul id="apps">
      ${state.apps
        .map(
          (app) =>
            `<li><a href="${escapeHtml(app.url)}">${escapeHtml(app.name)}</a><div class="muted">${escapeHtml(app.status)}</div></li>`,
        )
        .join("")}
    </ul>
  </main>
</div>
<script>
(function () {
  var form = document.getElementById('build');
  var prompt = document.getElementById('prompt');
  var submit = document.getElementById('submit');
  var status = document.getElementById('status');
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = '';
    status.appendChild(el('p', 'muted', 'Building…'));
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
      status.textContent = '';
      status.appendChild(el('p', 'ok', 'Deployed ' + body.app.name));
      var link = el('a', '', 'Open app');
      link.href = body.url;
      status.appendChild(link);
      prompt.value = '';
    }).catch(function (error) {
      status.textContent = '';
      status.appendChild(el('p', 'error', error.message));
    }).finally(function () { submit.disabled = false; });
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

