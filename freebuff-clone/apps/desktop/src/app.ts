import type { FreebuffClient } from "@freebuff/sdk";
import type { AdDecision, QuotaSnapshot } from "@freebuff/shared";
import { AppError } from "@freebuff/shared";
import { sponsoredAdHtml } from "@freebuff/ads";
import { TileStore, type TileSession } from "./sessions";
import { parseStreamEvent, streamEventToLine } from "./stream";
import {
  isWorkspaceId,
  layoutWorkspace,
  validateWorkspaceChrome,
  WORKSPACES,
  type TileAd,
  type TileView,
  type WorkspaceId,
} from "./tiles";
import {
  escapeHtml,
  initials,
  renderDesktopPage,
  type DesktopPageState,
} from "./page";

export interface DesktopAppOptions {
  readonly client: FreebuffClient;
  readonly sessionId?: string;
  readonly platformUrl: string;
  readonly now?: () => Date;
  /**
   * Streams the platform's NDJSON build output. When it is missing the shell
   * falls back to the SDK's non-streaming build and replays its timeline as
   * steps, so the surface still works against an older platform.
   */
  readonly buildStream?: (prompt: string) => Promise<Response>;
}

export interface DesktopState {
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
  readonly tiles: readonly {
    readonly id: string;
    readonly workspace: WorkspaceId;
    readonly title: string;
    readonly status: string;
    readonly lines: number;
    readonly appUrl?: string;
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

const redirect = (location: string): Response =>
  new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
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
    default:
      return 500;
  }
};

const planOf = (plan: string): "free" | "paid" => (plan === "paid" ? "paid" : "free");

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const parsed: unknown = await request.json();
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    }
    if (contentType.includes("form")) {
      const form = await request.formData();
      const record: Record<string, unknown> = {};
      form.forEach((value, key) => {
        record[key] = typeof value === "string" ? value : "";
      });
      return record;
    }
  } catch {
    throw new AppError({
      code: "validation_failed",
      message: "Request body must be valid JSON or a form",
    });
  }
  return {};
};

const stringField = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? String(body[key]) : "";

const appTiles = (
  state: DesktopPageState,
): readonly TileView[] =>
  state.apps.map((app) => ({
    id: `app-${app.id}`,
    workspace: "apps" as const,
    title: app.name,
    status: "deployed" as const,
    prompt: "",
    lines: [{ step: "deployed", status: "ok" as const, detail: app.url }],
    appUrl: app.url,
    plan: state.plan,
  }));

const sessionTile = (tile: TileSession, plan: "free" | "paid"): TileView => ({
  id: tile.id,
  workspace: tile.workspace,
  title: tile.title,
  status: tile.status,
  prompt: tile.prompt,
  lines: tile.lines,
  ...(tile.appUrl === undefined ? {} : { appUrl: tile.appUrl }),
  plan,
});

/**
 * Desktop surface: a local window manager over the same platform API. Accounts,
 * quota, ads and apps are server-authoritative; the shell only renders them and
 * owns its own tile layout.
 */
export const createDesktopApp = (
  options: DesktopAppOptions,
): { readonly fetch: (request: Request) => Promise<Response> } => {
  const sessionId = options.sessionId ?? "desktop-local";
  const store = new TileStore();

  const ensureDefaultTile = (): void => {
    if (store.list("build").length !== 0) return;
    store.create({ workspace: "build", title: "Session 1" });
  };

  const loadAccount = async (): Promise<{
    readonly state: DesktopPageState;
    readonly ad: AdDecision | null;
  }> => {
    const user = await options.client.me();
    const quota = await options.client.quota();
    const apps = await options.client.listApps();
    const decision = await options.client.ads({
      slot: "desktop.sidebar",
      surface: "desktop",
      session: sessionId,
    });
    const plan = planOf(user.plan);
    const state: DesktopPageState = {
      email: user.email,
      plan,
      quota: quota.snapshot,
      apps: apps.map((app) => ({
        id: app.id,
        name: typeof app.spec["name"] === "string" ? app.spec["name"] : app.slug,
        status: app.status,
        url: app.url,
      })),
    };
    return { state, ad: plan === "free" ? decision.decision : null };
  };

  const workspaceTiles = (
    workspace: WorkspaceId,
    state: DesktopPageState,
  ): readonly TileView[] => {
    if (workspace === "apps") return appTiles(state);
    if (workspace === "history") {
      return store.finished().map((tile) => sessionTile(tile, state.plan));
    }
    return store.list("build").map((tile) => sessionTile(tile, state.plan));
  };

  const withAd = (
    tiles: readonly TileView[],
    ad: AdDecision | null,
  ): readonly TileView[] => {
    if (ad === null || tiles.length === 0) return tiles;
    const slot: TileAd = { decision: ad, html: sponsoredAdHtml(ad.ad) };
    return tiles.map((tile, index) =>
      index === 0 ? { ...tile, ad: slot } : tile,
    );
  };

  const counts = (state: DesktopPageState): Record<WorkspaceId, number> => ({
    build: store.list("build").length,
    history: store.finished().length,
    apps: state.apps.length,
  });

  const buildTile = async (id: string, prompt: string): Promise<Response> => {
    store.begin(id, prompt);
    const upstream =
      options.buildStream === undefined ? undefined : await options.buildStream(prompt);

    if (upstream === undefined) {
      // Older platform: replay the SDK timeline as a stream instead of faking steps.
      const built = await options.client.buildApp(prompt);
      const lines = built.timeline.map((step) => ({ step: step.step, status: "ok" as const, detail: step.detail ?? "" }));
      lines.forEach((line) => store.append(id, line));
      store.finish(id, { status: "deployed", appUrl: built.url });
      const events = [
        ...built.timeline.map((step) =>
          JSON.stringify({ type: "step", step: step.step, status: "ok", detail: step.detail ?? "" }),
        ),
        JSON.stringify({
          type: "done",
          url: built.url,
          app: { id: built.app.id, name: stringField(built.app.spec, "name") || built.app.slug },
        }),
      ];
      return new Response(`${events.join("\n")}\n`, {
        status: 200,
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (!upstream.ok || upstream.body === null) {
      store.finish(id, { status: "failed" });
      let message = "Build failed";
      try {
        const body = (await upstream.json()) as { message?: string };
        if (typeof body.message === "string") message = body.message;
      } catch {
        // keep the generic message
      }
      const status = upstream.status >= 400 ? upstream.status : 502;
      return json(status, { error: "build_failed", code: "build_failed", message, retryable: true });
    }

    const decoder = new TextDecoder();
    const upstreamReader = upstream.body.getReader();
    let buffer = "";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const emit = (chunk: string): void => {
          controller.enqueue(encoder.encode(chunk));
        };
        const handle = (line: string): void => {
          const event = parseStreamEvent(line);
          if (event === undefined) return;
          const row = streamEventToLine(event);
          if (row !== undefined) store.append(id, row);
          if (event.type === "done") {
            store.finish(id, { status: "deployed", appUrl: event.url });
          }
          if (event.type === "error") {
            store.finish(id, { status: "failed" });
          }
          emit(`${line}\n`);
        };
        const pump = (): void => {
          upstreamReader
            .read()
            .then((chunk) => {
              if (chunk.done) {
                if (buffer.trim().length > 0) handle(buffer);
                buffer = "";
                controller.close();
                return;
              }
              buffer += decoder.decode(chunk.value, { stream: true });
              const parts = buffer.split("\n");
              buffer = parts.pop() ?? "";
              parts.forEach((line) => {
                if (line.trim().length > 0) handle(line);
              });
              pump();
            })
            .catch(() => {
              store.append(id, { step: "error", status: "failed", detail: "Stream interrupted" });
              store.finish(id, { status: "failed" });
              controller.close();
            });
        };
        pump();
      },
      cancel() {
        upstreamReader.cancel().catch(() => undefined);
        store.finish(id, { status: "failed" });
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  };

  const renderPage = async (
    workspace: WorkspaceId,
    notice?: string,
  ): Promise<Response> => {
    const { state, ad } = await loadAccount();
    ensureDefaultTile();
    const tiles = withAd(workspaceTiles(workspace, state), ad);
    const viewport = { width: 1440, height: 820 };
    validateWorkspaceChrome(tiles, layoutWorkspace(tiles.length, viewport));
    return new Response(
      renderDesktopPage({
        state,
        tiles,
        workspace,
        counts: counts(state),
        platformUrl: options.platformUrl,
        ...(notice === undefined || notice.length === 0 ? {} : { notice }),
      }),
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
  };

  const buildState = async (): Promise<DesktopState> => {
    const { state, ad } = await loadAccount();
    ensureDefaultTile();
    return {
      email: state.email,
      plan: state.plan,
      quota: state.quota,
      ad,
      apps: state.apps,
      tiles: [...store.list("build"), ...store.finished().filter((tile) => tile.workspace !== "build")].map(
        (tile) => ({
          id: tile.id,
          workspace: tile.workspace,
          title: tile.title,
          status: tile.status,
          lines: tile.lines.length,
          ...(tile.appUrl === undefined ? {} : { appUrl: tile.appUrl }),
        }),
      ),
    };
  };

  return {
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/") {
          const requested = url.searchParams.get("workspace") ?? "build";
          const notice = url.searchParams.get("notice") ?? undefined;
          return await renderPage(isWorkspaceId(requested) ? requested : "build", notice);
        }

        if (request.method === "GET" && url.pathname === "/api/state") {
          return json(200, await buildState());
        }

        if (request.method === "POST" && url.pathname === "/api/tiles") {
          const body = await readBody(request);
          const requested = stringField(body, "workspace");
          if (!isWorkspaceId(requested) || requested !== "build") {
            throw new AppError({
              code: "validation_failed",
              message: "Tiles can only be added to the build workspace",
            });
          }
          const existing = store.list("build").length;
          const tile = store.create({
            workspace: "build",
            title: `Session ${String(existing + 1)}`,
          });
          if ((request.headers.get("content-type") ?? "").includes("application/json")) {
            return json(201, { tile });
          }
          return redirect(`/?workspace=build&tile=${encodeURIComponent(tile.id)}`);
        }

        if (request.method === "GET" && url.pathname === "/api/ads/rotate") {
          const { state, ad } = await loadAccount();
          if (ad === null || state.plan !== "free") {
            return json(200, { adId: null, html: "", height: 0 });
          }
          return json(200, {
            adId: String(ad.ad.id),
            html: sponsoredAdHtml(ad.ad),
            height: 84,
          });
        }

        if (request.method === "POST" && url.pathname === "/api/build") {
          const body = await readBody(request);
          const prompt = stringField(body, "prompt");
          const built = await options.client.buildApp(prompt);
          return json(201, {
            app: {
              id: built.app.id,
              name: stringField(built.app.spec, "name") || built.app.slug,
              status: built.app.status,
            },
            url: built.url,
            timeline: built.timeline,
          });
        }

        const tileRoute = /^\/api\/tiles\/([^/]+)\/(build|close)$/.exec(url.pathname);
        if (request.method === "POST" && tileRoute !== null) {
          const id = decodeURIComponent(tileRoute[1] ?? "");
          const action = tileRoute[2];
          if (action === "close") {
            store.close(id);
            if ((request.headers.get("content-type") ?? "").includes("form")) {
              return redirect("/?workspace=build");
            }
            return json(200, { closed: id });
          }
          const body = await readBody(request);
          const prompt = stringField(body, "prompt").trim();
          if (prompt.length === 0) {
            throw new AppError({
              code: "validation_failed",
              message: "Describe the app you want to build",
            });
          }
          return await buildTile(id, prompt);
        }

        return json(404, {
          error: "not_found",
          code: "not_found",
          message: "Unknown route",
          retryable: false,
        });
      } catch (error) {
        if (error instanceof AppError) {
          // A form submission gets the workspace back with an explanation rather
          // than a JSON error page in the window.
          if (
            request.method === "POST" &&
            url.pathname === "/api/tiles" &&
            (request.headers.get("content-type") ?? "").includes("form")
          ) {
            const notice =
              error.code === "conflict"
                ? error.message
                : "That tile could not be added.";
            return redirect(`/?workspace=build&notice=${encodeURIComponent(notice)}`);
          }
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

export { WORKSPACES, escapeHtml, initials };
