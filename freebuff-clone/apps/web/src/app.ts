import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { AuthService, PhoneVerificationService, SubscriptionService } from "@freebuff/auth";
import type { AdEngine } from "@freebuff/ads";
import { SPONSORED_LABEL, sponsoredAdHtml } from "@freebuff/ads";
import type { QuotaService } from "@freebuff/quota";
import {
  AppError,
  adSlotSchema,
  sessionIdSchema,
  surfaceSchema,
} from "@freebuff/shared";
import type { Plan } from "@freebuff/shared";
import type { AppRecord, PlatformStore } from "./store";
import type { AppRuntime } from "./runtime";
import { createEjectBundle, ejectToGitHub, readSourceFiles } from "./eject";
import { builderHtml } from "./ui";

export interface AppBuilder {
  build(options: {
    readonly prompt: string;
    readonly signal?: AbortSignal;
    readonly plan: Plan;
    readonly ownerId?: string;
    readonly onStep?: (step: {
      readonly step: string;
      readonly status: string;
      readonly detail?: string;
    }) => void;
  }): Promise<{
    readonly app: AppRecord;
    readonly urlPath: string;
    readonly timeline: readonly {
      readonly step: string;
      readonly status: string;
      readonly detail?: string;
    }[];
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  }>;
}

export interface WebAppOptions {
  readonly store: PlatformStore;
  readonly auth: AuthService;
  readonly runtime: AppRuntime;
  readonly root: string;
  readonly builder?: AppBuilder;
  readonly modelReady?: boolean;
  readonly modelId?: string;
  readonly now?: () => Date;
  /** When present, builds require a session and consume server quota. */
  readonly quota?: QuotaService;
  readonly ads?: AdEngine;
  readonly phone?: PhoneVerificationService;
  readonly subscriptions?: SubscriptionService;
  readonly countryCode?: string;
  /** Enables the local checkout completion route. Never set in production. */
  readonly allowDevBilling?: boolean;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const html = (status: number, body: string): Response =>
  new Response(body, { status, headers: HTML_HEADERS });

/** Unknown routes use the same error envelope as every other failure. */
const notFound = (): Response =>
  json(404, {
    error: "not_found",
    code: "not_found",
    message: "Unknown route",
    retryable: false,
  });

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
    case "provider_error":
    case "provider_rate_limited":
      return 502;
    case "cancelled":
      return 499;
    default:
      return 500;
  }
};

const readJson = async (
  request: Request,
  maxBytes = 1_000_000,
): Promise<Record<string, unknown>> => {
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new AppError({
      code: "validation_failed",
      message: "Request body is too large",
    });
  }
  if (text.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError({
      code: "validation_failed",
      message: "Request body must be valid JSON",
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError({
      code: "validation_failed",
      message: "Request body must be a JSON object",
    });
  }
  return parsed as Record<string, unknown>;
};

const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

const publicApp = (app: AppRecord, origin: string): Record<string, unknown> => ({
  id: app.id,
  slug: app.slug,
  status: app.status,
  spec: app.spec,
  createdAt: app.createdAt,
  ...(app.deployedAt === undefined ? {} : { deployedAt: app.deployedAt }),
  url: new URL(`/s/${app.slug}/`, origin).toString(),
  usage: { inputTokens: app.inputTokens, outputTokens: app.outputTokens },
});

/** Minimal branded shell for the one-off HTML responses (auth, 404). */
const simplePage = (options: {
  readonly title: string;
  readonly heading: string;
  readonly message: string;
  readonly linkHref?: string;
  readonly linkLabel?: string;
  readonly script?: string;
}): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${options.title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #07090f; color: #e9edf7;
    font: 15px/1.6 "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased; }
  body::before { content: ""; position: fixed; inset: 0; z-index: -1;
    background: radial-gradient(760px 460px at 12% 0%, rgba(124,140,255,.24), transparent 65%),
      radial-gradient(700px 420px at 88% 10%, rgba(34,211,238,.16), transparent 62%); }
  .card { width: min(440px, 100%); border: 1px solid rgba(255,255,255,.1); border-radius: 20px;
    padding: 30px 28px; text-align: center;
    background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
    box-shadow: 0 30px 70px -30px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.07); }
  .mark { display: grid; place-items: center; width: 42px; height: 42px; margin: 0 auto 16px;
    border-radius: 13px; color: #fff;
    background: linear-gradient(140deg, #7c8cff, #22d3ee 65%, #a855f7);
    box-shadow: 0 8px 22px rgba(124,140,255,.35), inset 0 1px 0 rgba(255,255,255,.4); }
  .mark svg { width: 22px; height: 22px; }
  h1 { margin: 0 0 8px; font-size: 21px; letter-spacing: -.02em; font-weight: 630; }
  p { margin: 0; color: #9aa5b8; font-size: 14px; }
  a.btn { display: inline-block; margin-top: 20px; padding: 10px 18px; border-radius: 11px;
    font-weight: 600; font-size: 13.5px; color: #080b14; text-decoration: none;
    background: linear-gradient(135deg, #aab4ff, #7c8cff 45%, #22d3ee); }
</style></head>
<body><main class="card">
  <span class="mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 14.9 9l6.6 3-6.6 3L12 21.5 9.1 15 2.5 12l6.6-3L12 2.5Z" fill="currentColor"/></svg></span>
  <h1>${options.heading}</h1>
  <p>${options.message}</p>
  ${options.linkHref === undefined || options.linkLabel === undefined ? "" : `<a class="btn" href="${options.linkHref}">${options.linkLabel}</a>`}
</main>${options.script === undefined ? "" : `
<script>${options.script}</script>`}
</body></html>`;

/**
 * The web surface: builder API, deployed static apps, generated-app auth, data
 * and file APIs. Handlers take a Request and return a Response so the whole
 * surface is testable without a listening socket.
 */
export const createWebApp = (
  options: WebAppOptions,
): { readonly fetch: (request: Request) => Promise<Response> } => {
  const requireApp = (id: string): AppRecord => {
    const app = options.store.findApp(id);
    if (app === undefined) {
      throw new AppError({ code: "not_found", message: "App not found" });
    }
    return app;
  };

  const requireUser = async (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null || match[1] === undefined) {
      throw new AppError({ code: "unauthorized", message: "Sign in required" });
    }
    return options.auth.verifySession(match[1]);
  };

  const optionalUser = async (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null || match[1] === undefined) {
      return undefined;
    }
    return options.auth.verifySession(match[1]).catch(() => undefined);
  };

  /** Apps built by an account are only manageable by that account. */
  const requireOwnedApp = async (
    app: AppRecord,
    request: Request,
  ): Promise<AppRecord> => {
    if (app.ownerId === undefined) {
      return app;
    }
    const user = await requireUser(request);
    if (String(user.id) !== app.ownerId) {
      throw new AppError({ code: "forbidden", message: "Not your app" });
    }
    return app;
  };

  const serveBuild = async (app: AppRecord, rest: readonly string[]): Promise<Response> => {
    const buildRoot = resolve(options.root, "apps", app.id, "build");
    const relative = rest.length === 0 ? "index.html" : rest.join("/");
    const target = resolve(buildRoot, relative);
    if (!target.startsWith(`${buildRoot}${sep}`)) {
      return html(
        404,
        simplePage({ title: "Not found", heading: "Page not found", message: "This file is not part of the published app." }),
      );
    }
    try {
      const bytes = await readFile(target);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "content-type":
            CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "public, max-age=60",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return html(
        404,
        simplePage({ title: "Not found", heading: "Page not found", message: "This file is not part of the published app." }),
      );
    }
  };

  const completePage = (app: AppRecord, sessionToken: string, redirect: string): string => {
    const key = `freebuff.session.${app.id}`;
    return simplePage({
      title: "Signed in",
      heading: "Signed in",
      message: "Redirecting you back to the app…",
      script: `localStorage.setItem(${scriptJson(key)},${scriptJson(sessionToken)});location.replace(${scriptJson(redirect)});`,
    });
  };

  /**
   * Shared guard for both build routes: provider presence, session, phone
   * verification and the authoritative hour charge. Returns the request's
   * prompt so the JSON and streaming routes cannot drift.
   */
  const prepareBuild = async (
    request: Request,
  ): Promise<{
    readonly prompt: string;
    readonly plan: Plan;
    readonly ownerId?: string;
  }> => {
    if (options.builder === undefined) {
      throw new AppError({
        code: "provider_error",
        message:
          "No model provider is configured. Set DEEPSEEK_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY.",
      });
    }
    const user =
      options.quota === undefined ? undefined : await requireUser(request);
    const body = await readJson(request);
    const prompt = typeof body["prompt"] === "string" ? body["prompt"] : "";

    let plan: Plan = user?.plan ?? "free";
    if (options.quota !== undefined && user !== undefined) {
      const evaluation = await options.quota.beginHour({
        userId: user.id,
        plan: user.plan,
        countryCode: user.plan === "free" ? (options.countryCode ?? "US") : "US",
        phoneVerified: user.phoneVerified,
      });
      if (!evaluation.decision.allowed) {
        const reason = evaluation.decision.reason;
        throw new AppError({
          code:
            reason === "quota_exhausted"
              ? "quota_exceeded"
              : reason === "phone_verification_required"
                ? "verification_required"
                : "forbidden",
          message:
            reason === "quota_exhausted"
              ? `Hour quota exhausted. It resets at ${evaluation.snapshot.resetsAt}`
              : reason === "phone_verification_required"
                ? "Verify your phone number to keep using the free tier"
                : "This account is suspended",
        });
      }
      plan = user.plan;
    }

    return {
      prompt,
      plan,
      ...(user === undefined ? {} : { ownerId: String(user.id) }),
    };
  };

  return {
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter((part) => part.length > 0);
      try {
        if (parts.length === 0 && request.method === "GET") {
          const landingAd = options.ads?.serve({
            slot: "web.builder",
            plan: "free",
            topics: [],
            seed: `landing-${(options.now ?? (() => new Date()))().toISOString().slice(0, 10)}`,
            surface: "web",
            sessionId: sessionIdSchema.parse("web-landing"),
          });
          return html(
            200,
            builderHtml({
              modelReady: options.modelReady === true,
              ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
              ...(landingAd === undefined
                ? {}
                : { adHtml: sponsoredAdHtml(landingAd.ad) }),
            }),
          );
        }

        if (parts[0] === "s" && parts.length >= 2 && request.method === "GET") {
          const app = options.store.findAppBySlug(decodeURIComponent(parts[1] ?? ""));
          if (app === undefined || app.status !== "deployed") {
            return html(
              404,
              simplePage({
                title: "App not found",
                heading: "App not found",
                message: "This app is not published, or the link is out of date.",
                linkHref: "/",
                linkLabel: "Back to the builder",
              }),
            );
          }
          return serveBuild(app, parts.slice(2));
        }

        if (
          parts[0] === "api" &&
          parts[1] === "me" &&
          parts.length === 2 &&
          request.method === "GET"
        ) {
          const user = await requireUser(request);
          return json(200, {
            user: {
              id: user.id,
              email: user.email,
              plan: user.plan,
              phoneVerified: user.phoneVerified,
              createdAt: user.createdAt,
            },
          });
        }

        if (
          parts[0] === "api" &&
          parts[1] === "quota" &&
          parts.length === 2 &&
          request.method === "GET"
        ) {
          if (options.quota === undefined) {
            throw new AppError({
              code: "internal",
              message: "Quota is not configured on this deployment",
            });
          }
          const user = await requireUser(request);
          const evaluation = await options.quota.snapshot({
            userId: user.id,
            plan: user.plan,
            countryCode: user.plan === "free" ? (options.countryCode ?? "US") : "US",
            phoneVerified: user.phoneVerified,
          });
          return json(200, {
            snapshot: evaluation.snapshot,
            decision: evaluation.decision,
          });
        }

        if (
          parts[0] === "api" &&
          parts[1] === "auth" &&
          parts[2] === "magic" &&
          (parts[3] === "request" || parts[3] === "complete") &&
          request.method === "POST"
        ) {
          const body = await readJson(request);
          if (parts[3] === "request") {
            const email = typeof body["email"] === "string" ? body["email"] : "";
            const issued = await options.auth.requestMagicLink(email);
            return json(200, {
              token: issued.token,
              expiresAt: issued.expiresAt,
              delivery: "dev",
            });
          }
          const token = typeof body["token"] === "string" ? body["token"] : "";
          const session = await options.auth.completeMagicLink(token);
          return json(200, {
            sessionToken: session.sessionToken,
            user: { id: session.user.id, email: session.user.email },
          });
        }

        if (
          parts[0] === "api" &&
          parts[1] === "auth" &&
          parts[2] === "phone" &&
          (parts[3] === "request" || parts[3] === "verify") &&
          request.method === "POST"
        ) {
          if (options.phone === undefined) {
            throw new AppError({
              code: "internal",
              message: "Phone verification is not configured on this deployment",
            });
          }
          const user = await requireUser(request);
          const body = await readJson(request);
          const phone = typeof body["phone"] === "string" ? body["phone"] : "";
          if (parts[3] === "request") {
            return json(
              200,
              await options.phone.requestCode({ userId: user.id, phone }),
            );
          }
          const code = typeof body["code"] === "string" ? body["code"] : "";
          await options.phone.verifyCode({ userId: user.id, phone, code });
          return json(200, { verified: true });
        }

        if (
          parts[0] === "api" &&
          parts[1] === "ads" &&
          parts.length === 2 &&
          request.method === "GET"
        ) {
          const slot = adSlotSchema.safeParse(url.searchParams.get("slot") ?? "");
          if (!slot.success) {
            throw new AppError({
              code: "validation_failed",
              message: "Unknown ad slot",
            });
          }
          if (options.ads === undefined) {
            return json(200, { decision: null, label: SPONSORED_LABEL });
          }
          const user = await optionalUser(request);
          const surfaceParam = surfaceSchema.safeParse(
            url.searchParams.get("surface") ?? "web",
          );
          const sessionParam =
            url.searchParams.get("session") ??
            request.headers.get("x-session-id") ??
            "web-anonymous";
          const topics = (url.searchParams.get("topics") ?? "")
            .split(",")
            .map((topic) => topic.trim().toLowerCase())
            .filter((topic) => topic.length > 0)
            .slice(0, 20);
          const decision = options.ads.serve({
            slot: slot.data,
            plan: user?.plan ?? "free",
            topics,
            seed: sessionParam,
            surface: surfaceParam.success ? surfaceParam.data : "web",
            sessionId: sessionIdSchema.parse(sessionParam.slice(0, 128)),
          });
          return json(200, {
            decision: decision ?? null,
            label: SPONSORED_LABEL,
            plan: user?.plan ?? "free",
          });
        }

        if (
          parts[0] === "api" &&
          parts[1] === "billing" &&
          parts[2] === "status" &&
          request.method === "GET"
        ) {
          const user = await requireUser(request);
          const recorded =
            options.subscriptions === undefined
              ? undefined
              : await options.subscriptions.record(user.id);
          return json(200, {
            plan: user.plan,
            ...(recorded?.subscription === undefined
              ? {}
              : { subscription: recorded.subscription }),
          });
        }

        if (
          parts[0] === "api" &&
          parts[1] === "billing" &&
          parts[2] === "checkout" &&
          request.method === "POST"
        ) {
          if (options.subscriptions === undefined) {
            throw new AppError({
              code: "internal",
              message: "Billing is not configured on this deployment",
            });
          }
          const user = await requireUser(request);
          const origin = new URL(request.url).origin;
          const checkout = await options.subscriptions.checkout({
            userId: user.id,
            successUrl: `${origin}/?billing=success`,
            cancelUrl: `${origin}/?billing=cancel`,
          });
          return json(200, checkout);
        }

        if (
          parts[0] === "api" &&
          parts[1] === "billing" &&
          parts[2] === "webhook" &&
          request.method === "POST"
        ) {
          if (options.subscriptions === undefined) {
            throw new AppError({
              code: "internal",
              message: "Billing is not configured on this deployment",
            });
          }
          const rawBody = await request.text();
          if (rawBody.length > 1_000_000) {
            throw new AppError({
              code: "validation_failed",
              message: "Webhook body is too large",
            });
          }
          const headers: Record<string, string | undefined> = {};
          request.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });
          const event = await options.subscriptions.handleWebhook({
            rawBody,
            headers,
          });
          return json(200, { received: event.type });
        }

        if (
          parts[0] === "api" &&
          parts[1] === "billing" &&
          parts[2] === "dev" &&
          parts[3] === "complete" &&
          request.method === "POST"
        ) {
          if (
            options.allowDevBilling !== true ||
            options.subscriptions === undefined
          ) {
            return notFound();
          }
          const user = await requireUser(request);
          const body = await readJson(request);
          const reference =
            typeof body["reference"] === "string" ? body["reference"] : "";
          const event = await options.subscriptions.completeLocalCheckout(reference);
          if (
            event.type !== "subscription.activated" ||
            String(event.userId) !== String(user.id)
          ) {
            throw new AppError({ code: "forbidden", message: "Not your checkout" });
          }
          return json(200, { plan: "paid" });
        }

        if (parts[0] !== "api" || parts[1] !== "apps") {
          return notFound();
        }

        if (parts.length === 3 && parts[2] === "build" && request.method === "POST") {
          const prepared = await prepareBuild(request);
          const builder = options.builder;
          if (builder === undefined) {
            throw new AppError({ code: "provider_error", message: "No model provider" });
          }
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const send = (event: Record<string, unknown>): void => {
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              };
              void builder
                .build({
                  ...prepared,
                  onStep: (step) => {
                    send({
                      type: "step",
                      step: step.step,
                      status: step.status,
                      ...(step.detail === undefined ? {} : { detail: step.detail }),
                    });
                  },
                })
                .then((result) => {
                  send({
                    type: "done",
                    app: publicApp(result.app, request.url),
                    url: new URL(result.urlPath, request.url).toString(),
                    timeline: result.timeline,
                    usage: result.usage,
                  });
                })
                .catch((error: unknown) => {
                  send({
                    type: "error",
                    code: error instanceof AppError ? error.code : "internal",
                    message: error instanceof Error ? error.message : "Build failed",
                  });
                })
                .finally(() => {
                  controller.close();
                });
            },
          });
          return new Response(stream, {
            status: 200,
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-store",
              "x-accel-buffering": "no",
            },
          });
        }

        if (parts.length === 2) {
          if (request.method === "GET") {
            const user =
              options.quota === undefined ? undefined : await requireUser(request);
            return json(200, {
              apps: options.store
                .listApps(50, user === undefined ? undefined : String(user.id))
                .map((app) => publicApp(app, request.url)),
            });
          }
          if (request.method === "POST") {
            const prepared = await prepareBuild(request);
            const builder = options.builder;
            if (builder === undefined) {
              throw new AppError({ code: "provider_error", message: "No model provider" });
            }
            const result = await builder.build(prepared);
            return json(201, {
              app: publicApp(result.app, request.url),
              url: new URL(result.urlPath, request.url).toString(),
              timeline: result.timeline,
              usage: result.usage,
            });
          }
        }

        const appId = decodeURIComponent(parts[2] ?? "");
        const app = requireApp(appId);
        await requireOwnedApp(app, request);
        const rest = parts.slice(3);

        if (rest.length === 0 && request.method === "GET") {
          return json(200, { app: publicApp(app, request.url) });
        }

        if (rest.length === 1 && rest[0] === "eject" && request.method === "GET") {
          const files = await readSourceFiles(options.root, app.id);
          const bundle = createEjectBundle(app, files);
          return new Response(new Uint8Array(bundle), {
            status: 200,
            headers: {
              "content-type": "application/gzip",
              "content-disposition": `attachment; filename="${app.slug}-source.tar.gz"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        }

        if (
          rest.length === 2 &&
          rest[0] === "eject" &&
          rest[1] === "github" &&
          request.method === "POST"
        ) {
          const body = await readJson(request);
          const token = typeof body["token"] === "string" ? body["token"] : "";
          const files = await readSourceFiles(options.root, app.id);
          const result = await ejectToGitHub({
            token,
            name: typeof body["name"] === "string" ? body["name"] : app.spec.name,
            description: app.spec.tagline,
            files,
          });
          return json(200, result);
        }

        if (rest[0] === "auth") {
          if (rest.length === 2 && rest[1] === "request" && request.method === "POST") {
            const body = await readJson(request);
            const email = typeof body["email"] === "string" ? body["email"] : "";
            const issued = await options.auth.requestMagicLink(email);
            const link = new URL(
              `/api/apps/${app.id}/auth/complete?token=${encodeURIComponent(issued.token)}&redirect=${encodeURIComponent(`/s/${app.slug}/`)}`,
              request.url,
            ).toString();
            return json(200, {
              expiresAt: issued.expiresAt,
              link,
              delivery: "dev",
            });
          }

          if (rest.length === 2 && rest[1] === "complete") {
            if (request.method === "POST") {
              const body = await readJson(request);
              const token = typeof body["token"] === "string" ? body["token"] : "";
              const session = await options.auth.completeMagicLink(token);
              return json(200, {
                sessionToken: session.sessionToken,
                user: { id: session.user.id, email: session.user.email },
              });
            }
            if (request.method === "GET") {
              const token = url.searchParams.get("token") ?? "";
              try {
                const session = await options.auth.completeMagicLink(token);
                const redirectParam = url.searchParams.get("redirect") ?? "";
                const redirect = redirectParam === `/s/${app.slug}/` ? redirectParam : `/s/${app.slug}/`;
                return html(200, completePage(app, session.sessionToken, redirect));
              } catch (error) {
                const message =
                  error instanceof AppError ? error.message : "Sign-in failed";
                return html(
                  401,
                  simplePage({
                    title: "Sign-in failed",
                    heading: "Sign-in failed",
                    message: message.replace(/</g, "&lt;"),
                    linkHref: "/",
                    linkLabel: "Back to the builder",
                  }),
                );
              }
            }
          }

          if (rest.length === 2 && rest[1] === "me" && request.method === "GET") {
            const user = await requireUser(request);
            return json(200, {
              user: { id: user.id, email: user.email, plan: user.plan },
            });
          }
        }

        if (rest[0] === "data" && rest.length >= 2) {
          const user = await requireUser(request);
          const entity = decodeURIComponent(rest[1] ?? "");
          if (rest.length === 2) {
            if (request.method === "GET") {
              const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
              const rows = await options.runtime.listRows(
                app,
                entity,
                String(user.id),
                Number.isNaN(limit) ? 50 : limit,
              );
              return json(200, { rows });
            }
            if (request.method === "POST") {
              const body = await readJson(request);
              const row = await options.runtime.createRow(app, entity, String(user.id), body);
              return json(201, { row });
            }
          }
          if (rest.length === 3 && request.method === "DELETE") {
            await options.runtime.deleteRow(
              app,
              entity,
              String(user.id),
              decodeURIComponent(rest[2] ?? ""),
            );
            return json(200, { deleted: true });
          }
        }

        if (rest[0] === "files") {
          const user = await requireUser(request);
          if (rest.length === 1) {
            if (request.method === "GET") {
              const files = options.store.listFiles(app.id, String(user.id));
              return json(200, {
                files: files.map((file) => ({
                  id: file.id,
                  name: file.name,
                  contentType: file.contentType,
                  size: file.size,
                  createdAt: file.createdAt,
                })),
              });
            }
            if (request.method === "POST") {
              const body = await readJson(request, 8_000_000);
              const file = await options.runtime.saveFile(app, String(user.id), body);
              return json(201, {
                file: {
                  id: file.id,
                  name: file.name,
                  contentType: file.contentType,
                  size: file.size,
                },
              });
            }
          }
          if (rest.length === 2 && request.method === "GET") {
            const { file, bytes } = await options.runtime.readFile(
              app,
              String(user.id),
              decodeURIComponent(rest[1] ?? ""),
            );
            const inline =
              file.contentType.startsWith("image/") ||
              file.contentType === "application/pdf" ||
              file.contentType === "text/plain" ||
              file.contentType === "application/json";
            return new Response(new Uint8Array(bytes), {
              status: 200,
              headers: {
                "content-type": file.contentType,
                "content-length": String(bytes.length),
                "cache-control": "private, no-store",
                "x-content-type-options": "nosniff",
                "content-disposition": `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/["\\]/g, "_")}"`,
              },
            });
          }
        }

        return notFound();
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
