import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AuthService, InMemoryAuthStore } from "@freebuff/auth";
import { openSqliteDatabase } from "@freebuff/db";
import {
  AdEngine,
  defaultAdInventory,
  InMemoryAdEventStore,
  sponsoredAdHtml,
} from "@freebuff/ads";
import type { Ad } from "@freebuff/shared";
import { createWebApp } from "../../../apps/web/src/app";
import { buildApp } from "../../../apps/web/src/builder";
import { LocalHostingAdapter } from "../../../apps/web/src/hosting";
import { AppRuntime } from "../../../apps/web/src/runtime";
import { PlatformStore } from "../../../apps/web/src/store";
import { buildLogSponsorFooter } from "../../../apps/web/src/ui";
import { ScriptedModel } from "../../support/scripted-model";

const SPEC = {
  name: "Recipe Box",
  tagline: "Save the recipes you actually cook",
  theme: { primary: "#2f81f7", accent: "#3fb950", radius: 10, dark: true },
  entities: [
    {
      name: "recipes",
      label: "Recipes",
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "servings", label: "Servings", type: "integer", required: false },
      ],
    },
  ],
};

const ORIGIN = "http://web.test";
const firstAd = defaultAdInventory.ads[0] as Ad;

const setup = async (): Promise<{
  readonly app: ReturnType<typeof createWebApp>;
  readonly root: string;
  readonly cleanup: () => Promise<void>;
}> => {
  const root = await mkdtemp(join(tmpdir(), "freebuff-web-ui-"));
  const model = new ScriptedModel([
    { text: JSON.stringify(SPEC) },
    { text: JSON.stringify(SPEC) },
  ]);
  const db = openSqliteDatabase(join(root, "platform.sqlite"));
  const store = new PlatformStore({ db });
  const auth = new AuthService({
    store: new InMemoryAuthStore(),
    secret: "test-secret-that-is-long-enough-1234",
  });
  const hosting = new LocalHostingAdapter({ root });
  const runtime = new AppRuntime({ root, store });
  const app = createWebApp({
    store,
    auth,
    runtime,
    root,
    modelReady: true,
    modelId: "scripted-model",
    ads: new AdEngine({
      inventory: defaultAdInventory,
      store: new InMemoryAdEventStore(),
    }),
    builder: {
      build: (options) =>
        buildApp({ store, hosting, root, model, modelId: "scripted-model" }, options),
    },
  });
  return {
    app,
    root,
    cleanup: async () => {
      db.close?.();
      await rm(root, { recursive: true, force: true });
    },
  };
};

const jsonRequest = (url: string, body: unknown): Request =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Phase 4 web builder UI", () => {
  it("renders the two-pane builder, build log and labelled sponsored footer", async () => {
    const context = await setup();
    try {
      const landing = await context.app.fetch(new Request(`${ORIGIN}/`));
      expect(landing.status).toBe(200);
      const html = await landing.text();

      // Two panes: prompt on the left, preview on the right.
      expect(html).toContain('class="studio"');
      expect(html).toContain('aria-labelledby="prompt-title"');
      expect(html).toContain('aria-labelledby="preview-title"');
      expect(html).toContain('id="preview"');
      expect(html).toContain("Deploy app");

      // Streaming build log with named steps.
      expect(html).toContain('id="build-log"');
      expect(html).toContain("spec → scaffolded → schema → auth → deployed");

      // Deploy and eject actions are present and wired.
      expect(html).toContain('id="download-source"');
      expect(html).toContain('id="eject-toggle"');
      expect(html).toContain('id="eject-form"');
      expect(html).toContain("/eject/github");
      expect(html).toContain('id="eject-token"');

      // One sponsored slot, labelled, and it is a sibling of the log.
      expect(html.split('class="sponsored-ad"')).toHaveLength(2);
      expect(html).toContain('class="sponsored-label"');
      expect(html).toContain(">Sponsored<");
      expect(html).toContain('class="log-sponsor"');
      const logSegment = html.slice(
        html.indexOf('id="build-log"'),
        html.indexOf("</ol>", html.indexOf('id="build-log"')),
      );
      expect(logSegment.toLowerCase()).not.toContain("sponsored");
      const previewStart = html.indexOf('aria-labelledby="preview-title"');
      const previewEnd = html.indexOf('class="panel log-region"');
      const previewSegment = html.slice(previewStart, previewEnd);
      expect(previewSegment.toLowerCase()).not.toContain("sponsored");
      expect(html.indexOf('class="log-sponsor"')).toBeGreaterThan(
        html.indexOf("</ol>"),
      );

      // The inline client script must parse (catches escaping bugs in the page).
      const scriptStart = html.indexOf("<script>") + "<script>".length;
      const scriptEnd = html.indexOf("</script>", scriptStart);
      const script = html.slice(scriptStart, scriptEnd);
      expect(script).toContain("/api/apps/build");
      expect(() => new Function(script)).not.toThrow();
    } finally {
      await context.cleanup();
    }
  }, 60_000);

  it("streams the build log as named steps and finishes with the deployed app", async () => {
    const context = await setup();
    try {
      const response = await context.app.fetch(
        jsonRequest(`${ORIGIN}/api/apps/build`, {
          prompt: "a recipe box with favourites",
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      const body = await response.text();
      const events = body
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      const steps = events.filter((event) => event["type"] === "step");
      expect(steps.map((step) => step["step"])).toEqual([
        "spec",
        "scaffolded",
        "schema",
        "auth",
        "deployed",
      ]);
      for (const step of steps) {
        expect(step["status"]).toBe("ok");
        expect(String(step["detail"] ?? "").length).toBeGreaterThan(0);
      }
      const done = events.at(-1);
      expect(done?.["type"]).toBe("done");
      const url = String(done?.["url"]);
      expect(url).toMatch(/^http:\/\/web\.test\/s\/recipe-box-[a-f0-9]{8}\/$/);

      // The deployed URL really serves the app.
      const page = await context.app.fetch(new Request(url));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Recipe Box");

      // The streaming route and the JSON route produce the same app artefact.
      const app = done?.["app"] as { id: string };
      expect(String(app.id).length).toBeGreaterThan(0);

      // Eject: the bundle downloads and Eject → GitHub refuses an empty token.
      const bundle = await context.app.fetch(
        new Request(`${ORIGIN}/api/apps/${app.id}/eject`),
      );
      expect(bundle.status).toBe(200);
      const buffered = Buffer.from(await bundle.arrayBuffer());
      const files = gunzipSync(buffered).toString("utf8");
      expect(files).toContain("index.html");

      const eject = await context.app.fetch(
        jsonRequest(`${ORIGIN}/api/apps/${app.id}/eject/github`, {
          token: "",
          name: "recipe-box",
        }),
      );
      // The eject route rejects a missing credential and says which one.
      expect(eject.status).toBe(401);
      expect(((await eject.json()) as { message: string }).message).toMatch(/token/i);
    } finally {
      await context.cleanup();
    }
  }, 60_000);

  it("refuses a sponsored footer that lost its literal label", () => {
    const valid = sponsoredAdHtml(firstAd);
    const footer = buildLogSponsorFooter(valid);
    expect(footer).toContain('class="log-sponsor"');
    expect(footer).toContain("Sponsored");
    expect(() =>
      buildLogSponsorFooter('<aside class="sponsored-ad"><strong>Promoted</strong></aside>'),
    ).toThrow(/label/);
  });
});
