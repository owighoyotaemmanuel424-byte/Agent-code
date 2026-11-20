import { adSlotSchema, AppError, sessionIdSchema } from "@freebuff/shared";
import type { SandboxManager } from "@freebuff/sandbox-orchestrator";
import type { AdEngine } from "@freebuff/ads";
import { SPONSORED_LABEL, sponsoredAdHtml } from "@freebuff/ads";
import { dashboardHtml } from "./dashboard";
import { sandboxPageHtml } from "./sandbox-ui";

export interface CloudAppOptions {
  readonly manager: SandboxManager;
  readonly providerName: string;
  /** Pre-authentication phase: one local tenant until hosted auth lands. */
  readonly tenantId?: string;
  readonly previewHint?: string;
  /** Free-tier sponsored inventory; paid accounts would be excluded here. */
  readonly ads?: AdEngine;
  /** GitHub OAuth app client id; the connect control is explained when absent. */
  readonly githubClientId?: string;
  readonly now?: () => Date;
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

const httpStatusFor = (error: AppError): number => {
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
    case "quota_exceeded":
      return 429;
    case "sandbox_failed":
    case "sandbox_unavailable":
      return 502;
    default:
      return 500;
  }
};

const readJsonObject = async (
  request: Request,
): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/**
 * HTTP surface for the sandbox dashboard. Handlers are pure Request → Response
 * so they can be tested without binding a port, and `server.ts` only wires a
 * runtime around them.
 */
export const createCloudApp = (
  options: CloudAppOptions,
): { readonly fetch: (request: Request) => Promise<Response> } => {
  const tenant = options.tenantId ?? "local";

  return {
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/healthz") {
          return json(200, { ok: true, provider: options.providerName });
        }

        if (request.method === "GET" && url.pathname === "/") {
          const landingAd = options.ads?.serve({
            slot: "cloud.dashboard",
            plan: "free",
            topics: [],
            seed: `cloud-${(options.now ?? (() => new Date()))().toISOString().slice(0, 10)}`,
            surface: "cloud",
            sessionId: sessionIdSchema.parse("cloud-dashboard"),
          });
          return new Response(
            dashboardHtml({
              providerName: options.providerName,
              previewHint:
                options.previewHint ??
                "Previews are served from this host while the platform is in local mode.",
              ...(landingAd === undefined
                ? {}
                : { adHtml: sponsoredAdHtml(landingAd.ad) }),
            }),
            {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            },
          );
        }

        if (request.method === "GET" && url.pathname === "/sandboxes") {
          const sandboxes = await options.manager.list(tenant);
          const selectedId = url.searchParams.get("sandbox") ?? undefined;
          const selected =
            selectedId === undefined
              ? undefined
              : await options.manager.status(selectedId, tenant).catch(() => undefined);
          const shareUrl =
            selected !== undefined && selected.phase === "ready"
              ? await options.manager.shareLink(String(selected.sandboxId), tenant).catch(() => undefined)
              : undefined;
          const sandboxAd = options.ads?.serve({
            slot: "cloud.dashboard",
            plan: "free",
            topics: [],
            seed: `cloud-sandboxes-${(options.now ?? (() => new Date()))().toISOString().slice(0, 10)}`,
            surface: "cloud",
            sessionId: sessionIdSchema.parse("cloud-sandboxes"),
          });
          return new Response(
            sandboxPageHtml({
              providerName: options.providerName,
              previewHint:
                options.previewHint ??
                "Previews are served from this host while the platform is in local mode.",
              sandboxes,
              ...(selected === undefined ? {} : { selected }),
              ...(shareUrl === undefined ? {} : { shareUrl }),
              ...(selectedId !== undefined && selected === undefined
                ? { notice: `Sandbox ${selectedId} was not found in this workspace.` }
                : {}),
              ...(options.githubClientId === undefined
                ? {}
                : { githubClientId: options.githubClientId }),
              ...(sandboxAd === undefined ? {} : { adHtml: sponsoredAdHtml(sandboxAd.ad) }),
            }),
            {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            },
          );
        }

        if (url.pathname === "/api/ads" && request.method === "GET") {
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
          const session = (
            url.searchParams.get("session") ??
            request.headers.get("x-session-id") ??
            "cloud-anonymous"
          ).slice(0, 128);
          const topics = (url.searchParams.get("topics") ?? "")
            .split(",")
            .map((topic) => topic.trim().toLowerCase())
            .filter((topic) => topic.length > 0)
            .slice(0, 20);
          const decision = options.ads.serve({
            slot: slot.data,
            plan: "free",
            topics,
            seed: session,
            surface: "cloud",
            sessionId: sessionIdSchema.parse(session),
          });
          return json(200, { decision: decision ?? null, label: SPONSORED_LABEL });
        }

        if (url.pathname === "/api/sandboxes") {
          if (request.method === "GET") {
            return json(200, { sandboxes: await options.manager.list(tenant) });
          }
          if (request.method === "POST") {
            const body = await readJsonObject(request);
            const repoUrl =
              typeof body["repoUrl"] === "string" ? body["repoUrl"].trim() : "";
            if (repoUrl.length === 0) {
              throw new AppError({
                code: "validation_failed",
                message: "repoUrl is required",
              });
            }
            const handle = await options.manager.create(tenant, {
              repoUrl,
              ...(typeof body["ref"] === "string" ? { ref: body["ref"] } : {}),
            });
            return json(201, {
              sandbox: handle.status,
              previewUrl: handle.previewUrl,
            });
          }
        }

        const match = /^\/api\/sandboxes\/([^/]+)(?:\/(logs|share|stop))?$/.exec(
          url.pathname,
        );
        if (match !== null) {
          const sandboxId = decodeURIComponent(match[1] ?? "");
          const action = match[2];

          if (action === undefined && request.method === "GET") {
            const status = await options.manager.status(sandboxId, tenant);
            return json(200, status);
          }
          if (action === "logs" && request.method === "GET") {
            const tail = Number.parseInt(url.searchParams.get("tail") ?? "50", 10);
            return json(200, {
              logs: await options.manager.logs(
                sandboxId,
                tenant,
                Number.isNaN(tail) ? 50 : Math.min(Math.max(tail, 1), 500),
              ),
            });
          }
          if (action === "share" && request.method === "GET") {
            return json(200, { url: await options.manager.shareLink(sandboxId, tenant) });
          }
          if (action === "stop" && request.method === "POST") {
            await options.manager.stop(sandboxId, tenant);
            return json(200, { stopped: true });
          }
          if (action === undefined && request.method === "DELETE") {
            await options.manager.remove(sandboxId, tenant);
            return json(200, { removed: true });
          }
        }

        return json(404, { error: "not_found", message: "Unknown route" });
      } catch (error) {
        if (error instanceof AppError) {
          return json(httpStatusFor(error), {
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
