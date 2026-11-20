import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthService,
  LocalBillingProvider,
  PhoneVerificationService,
  SubscriptionService,
} from "@freebuff/auth";
import { AdEngine, defaultAdInventory } from "@freebuff/ads";
import { openSqliteDatabase } from "@freebuff/db";
import { QuotaService } from "@freebuff/quota";
import { FreebuffClient } from "@freebuff/sdk";
import type { QuotaConfig } from "@freebuff/shared";
import { createWebApp } from "../../../apps/web/src/app";
import { SqliteAuthStore } from "../../../apps/web/src/auth-store";
import { buildApp } from "../../../apps/web/src/builder";
import { LocalHostingAdapter } from "../../../apps/web/src/hosting";
import {
  SqliteAdEventStore,
  SqliteQuotaStore,
  SqliteSubscriptionStore,
} from "../../../apps/web/src/phase5-store";
import { AppRuntime } from "../../../apps/web/src/runtime";
import { PlatformStore } from "../../../apps/web/src/store";
import { createDesktopApp } from "../../../apps/desktop/src/app";
import { ScriptedModel } from "../../support/scripted-model";

const ORIGIN = "http://desktop.test";
const SECRET = "desktop-secret-that-is-at-least-32-characters";

const QUOTA: QuotaConfig = {
  version: 1,
  default: { timeZone: "UTC", freeHoursPerDay: 2, paidHoursPerDay: 8 },
  countries: [],
};

const SPEC = {
  name: "Reading List",
  tagline: "Track the books you want to read",
  theme: { primary: "#2f81f7", accent: "#3fb950", radius: 10, dark: true },
  entities: [
    {
      name: "books",
      label: "Books",
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
    },
  ],
};

const OTHER_SPEC = {
  ...SPEC,
  name: "Watch List",
  tagline: "Films worth your evening",
  entities: [
    ...SPEC.entities,
    {
      name: "films",
      label: "Films",
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
    },
  ],
};

const json = (url: string, body: unknown): Request =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const streamSteps = (body: string): string[] =>
  body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string; step?: string })
    .filter((event) => event.type === "step")
    .map((event) => event.step ?? "");

describe("Phase 5 desktop UI: tiled workspaces", () => {
  it("tiles sessions with chrome-only sponsored slots and a workspace switcher", async () => {
    const root = await mkdtemp(join(tmpdir(), "freebuff-desktop-ui-"));
    const db = openSqliteDatabase(join(root, "platform.sqlite"));
    const now = new Date("2026-11-20T12:00:00.000Z");
    let token: string | undefined;
    try {
      const store = new PlatformStore({ db });
      const authStore = new SqliteAuthStore({ db });
      const auth = new AuthService({ store: authStore, secret: SECRET });
      const hosting = new LocalHostingAdapter({ root });
      const runtime = new AppRuntime({ root, store });
      const quota = new QuotaService({
        store: new SqliteQuotaStore({ db }),
        config: QUOTA,
        now: () => now,
      });
      const ads = new AdEngine({
        inventory: defaultAdInventory,
        store: new SqliteAdEventStore({ db }),
      });
      const phone = new PhoneVerificationService({ store: authStore, authStore, secret: SECRET });
      const subscriptions = new SubscriptionService({
        authStore,
        store: new SqliteSubscriptionStore({ db }),
        provider: new LocalBillingProvider(),
      });
      const model = new ScriptedModel([
        { text: JSON.stringify(SPEC) },
        { text: JSON.stringify(OTHER_SPEC) },
        { text: JSON.stringify(SPEC) },
      ]);
      const platform = createWebApp({
        store,
        auth,
        runtime,
        root,
        quota,
        ads,
        phone,
        subscriptions,
        countryCode: "US",
        now: () => now,
        builder: {
          build: (options) =>
            buildApp({ store, hosting, root, model, modelId: "scripted-model" }, options),
        },
      });

      const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
        platform.fetch(
          input instanceof Request ? input : new Request(String(input), init),
        )) as unknown as typeof fetch;
      const client = new FreebuffClient({ baseUrl: ORIGIN, fetchImpl });
      const link = await client.requestMagicLink("Tiler@Example.com");
      const session = await client.completeMagicLink(link.token);
      token = session.sessionToken;
      const challenge = await client.requestPhoneCode("+1 (415) 555-0111");
      await client.verifyPhone("+14155550111", challenge.code ?? "");

      const buildStream = async (prompt: string): Promise<Response> =>
        platform.fetch(
          new Request(`${ORIGIN}/api/apps/build`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token ?? ""}`,
            },
            body: JSON.stringify({ prompt }),
          }),
        );
      const shell = createDesktopApp({ client, platformUrl: ORIGIN, buildStream });

      // 1. One tile per workspace start, tiled chrome, and a switcher with counts.
      const buildPage = await shell.fetch(new Request(`${ORIGIN}/?workspace=build`));
      expect(buildPage.status).toBe(200);
      expect(buildPage.headers.get("cache-control")).toBe("no-store");
      const html = await buildPage.text();

      expect(html).toContain('class="workspaces"');
      expect(html).toContain('data-workspace-tab="build"');
      expect(html).toContain('data-workspace-tab="history"');
      expect(html).toContain('data-workspace-tab="apps"');
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('data-workspace="build"');
      expect(html).toContain('data-tile-id="tile-1"');
      expect(html).toContain('data-region="chrome"');
      expect(html).toContain('data-region="stream"');
      expect(html).toContain("--tile-chrome: 84px");

      // 2. The sponsored slot is in tile chrome, labelled once, and never in a stream.
      expect(html.split('class="sponsored-ad"')).toHaveLength(2);
      expect(html).toContain('class="sponsored-label"');
      expect(html).toContain(">Sponsored<");
      const chrome = html.slice(html.indexOf('data-region="chrome"'), html.indexOf('data-region="body"'));
      expect(chrome).toContain('class="sponsored-ad"');
      const stream = html.slice(html.indexOf('data-region="stream"'), html.indexOf("</ol>"));
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.toLowerCase()).not.toContain("sponsored");
      // The sidebar holds account and apps only; ads moved into tile chrome.
      const sidebar = html.slice(html.indexOf('class="sidebar"'), html.indexOf("<main>"));
      expect(sidebar.toLowerCase()).not.toContain("sponsored");
      expect(html.indexOf('class="sponsored-ad"')).toBeGreaterThan(html.indexOf("<main>"));
      // The inline client script parses.
      const scriptStart = html.indexOf("<script>") + "<script>".length;
      const script = html.slice(scriptStart, html.indexOf("</script>", scriptStart));
      expect(script).toContain("/api/tiles/");
      expect(() => new Function(script)).not.toThrow();

      // 3. Adding a tile is capped at four, then refused.
      const added = await shell.fetch(json(`${ORIGIN}/api/tiles`, { workspace: "build" }));
      expect(added.status).toBe(201);
      expect(((await added.json()) as { tile: { id: string } }).tile.id).toBe("tile-2");
      for (const _ of [0, 1]) {
        const more = await shell.fetch(json(`${ORIGIN}/api/tiles`, { workspace: "build" }));
        expect(more.status).toBe(201);
      }
      const capped = await shell.fetch(json(`${ORIGIN}/api/tiles`, { workspace: "build" }));
      expect(capped.status).toBe(409);
      expect(await capped.json()).toMatchObject({ code: "conflict" });

      // A form submission lands back on the workspace with an explanation.
      const formPost = await shell.fetch(
        new Request(`${ORIGIN}/api/tiles`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "workspace=build",
        }),
      );
      expect(formPost.status).toBe(303);
      const location = formPost.headers.get("location") ?? "";
      expect(location).toContain("notice=");
      const cappedPage = await (
        await shell.fetch(new Request(`${ORIGIN}${location}`))
      ).text();
      expect(cappedPage).toContain('class="notice"');
      expect(cappedPage).toContain("4 sessions");
      // At the cap the add button is disabled rather than submitting a doomed form.
      expect(cappedPage).toContain("+ Tile</button>");
      expect(cappedPage).not.toContain('action="/api/tiles"');

      // 4. Two tiles stream their own builds at the same time.
      const [firstStream, secondStream] = await Promise.all([
        shell.fetch(json(`${ORIGIN}/api/tiles/tile-1/build`, { prompt: "a reading list" })),
        shell.fetch(json(`${ORIGIN}/api/tiles/tile-2/build`, { prompt: "a watch list" })),
      ]);
      expect(firstStream.status).toBe(200);
      expect(secondStream.status).toBe(200);
      expect(firstStream.headers.get("content-type")).toContain("application/x-ndjson");
      const firstBody = await firstStream.text();
      const secondBody = await secondStream.text();
      const expected = ["spec", "scaffolded", "schema", "auth", "deployed"];
      expect(streamSteps(firstBody)).toEqual(expected);
      expect(streamSteps(secondBody)).toEqual(expected);
      expect(firstBody).toContain('"type":"done"');
      expect(secondBody).toContain('"type":"done"');

      const state = (await (await shell.fetch(new Request(`${ORIGIN}/api/state`))).json()) as {
        tiles: { id: string; status: string; lines: number; appUrl?: string }[];
      };
      const tileOne = state.tiles.find((tile) => tile.id === "tile-1");
      const tileTwo = state.tiles.find((tile) => tile.id === "tile-2");
      expect(tileOne).toMatchObject({ status: "deployed", lines: 6 });
      expect(tileTwo).toMatchObject({ status: "deployed", lines: 6 });
      expect(tileOne?.appUrl).not.toBe(tileTwo?.appUrl);
      expect(tileOne?.appUrl).toContain("/s/");

      // 5. Workspaces: history keeps finished streams, apps tiles live previews.
      const history = await (await shell.fetch(new Request(`${ORIGIN}/?workspace=history`))).text();
      expect(history).toContain('data-workspace="history"');
      expect(history).toContain('aria-current="page"');
      expect(history).toContain("deployed");
      expect(history).toContain('data-workspace-tab="history"');

      const apps = await (await shell.fetch(new Request(`${ORIGIN}/?workspace=apps`))).text();
      // Tiles are added from the build workspace only.
      expect(apps).not.toContain('action="/api/tiles"');
      expect(apps).toContain("tile-preview");
      expect(apps).toContain("<iframe");
      expect(apps).toContain("Reading List");

      const unknown = await (await shell.fetch(new Request(`${ORIGIN}/?workspace=nope`))).text();
      expect(unknown).toContain('data-workspace="build"');

      // 6. Rotation returns a labelled ad at the reserved height, so no layout shift.
      const rotate = await shell.fetch(new Request(`${ORIGIN}/api/ads/rotate`));
      expect(rotate.status).toBe(200);
      const rotation = (await rotate.json()) as { adId: string; html: string; height: number };
      expect(rotation.html).toContain('class="sponsored-label"');
      expect(rotation.html).toContain(">Sponsored<");
      expect(rotation.height).toBe(84);

      // 7. Splitters resize chrome and stream together, by pointer or keyboard.
      // A single tile has nothing to split; four tiles expose both handles.
      expect(html).not.toContain('role="separator"');
      const tiled = await (
        await shell.fetch(new Request(`${ORIGIN}/?workspace=build`))
      ).text();
      expect(tiled).toContain('role="separator"');
      expect(tiled).toContain('aria-orientation="vertical"');
      expect(tiled).toContain('tabindex="0"');
      expect(tiled).toContain('data-axis="column"');
      expect(tiled).toContain('data-axis="row"');
      expect(tiled).toContain('aria-valuenow="50"');

      const resized = await shell.fetch(
        json(`${ORIGIN}/api/layout`, { workspace: "build", column: 0.34, row: 0.62 }),
      );
      expect(resized.status).toBe(200);
      expect(await resized.json()).toMatchObject({ workspace: "build", column: 0.34, row: 0.62 });
      const afterResize = await (
        await shell.fetch(new Request(`${ORIGIN}/?workspace=build`))
      ).text();
      expect(afterResize).toContain('data-column="0.34"');
      expect(afterResize).toContain("0.34fr");
      expect(afterResize).toContain('aria-valuenow="34"');
      // The sponsored slot still lives in chrome at its reserved height.
      expect(afterResize).toContain('data-ad-height="84"');
      expect(afterResize.split('class="sponsored-ad"')).toHaveLength(2);
      const resizedStream = afterResize.slice(
        afterResize.indexOf('data-region="stream"'),
        afterResize.indexOf("</ol>"),
      );
      expect(resizedStream.toLowerCase()).not.toContain("sponsored");

      // Out-of-range and non-numeric splits are refused rather than silently clamped.
      for (const bad of [
        { workspace: "build", column: 0.95 },
        { workspace: "build", row: 0.05 },
        { workspace: "build", column: "wide" },
        { workspace: "nope", column: 0.4 },
      ]) {
        const rejected = await shell.fetch(json(`${ORIGIN}/api/layout`, bad));
        expect(rejected.status).toBe(422);
      }
      // The refusal left the stored split untouched.
      const kept = await (
        await shell.fetch(new Request(`${ORIGIN}/?workspace=build`))
      ).text();
      expect(kept).toContain('data-column="0.34"');

      // 8. Closing a tile keeps the workspace consistent.
      const closed = await shell.fetch(
        new Request(`${ORIGIN}/api/tiles/tile-2/close`, { method: "POST" }),
      );
      expect(closed.status).toBe(200);
      const afterClose = (await (await shell.fetch(new Request(`${ORIGIN}/api/state`))).json()) as {
        tiles: { id: string }[];
      };
      expect(afterClose.tiles.some((tile) => tile.id === "tile-2")).toBe(false);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
