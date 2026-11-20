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
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "finished", label: "Finished", type: "boolean", required: false },
      ],
    },
  ],
};

describe("desktop shell", () => {
  it("renders server state, builds through the platform and maps failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "freebuff-desktop-"));
    const db = openSqliteDatabase(join(root, "platform.sqlite"));
    let now = new Date("2026-11-19T12:00:00.000Z");
    const advanceHour = (): void => {
      now = new Date(now.getTime() + 61 * 60 * 1000);
    };
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
      const ads = new AdEngine({ inventory: defaultAdInventory, store: new SqliteAdEventStore({ db }) });
      const phone = new PhoneVerificationService({ store: authStore, authStore, secret: SECRET });
      const subscriptions = new SubscriptionService({
        authStore,
        store: new SqliteSubscriptionStore({ db }),
        provider: new LocalBillingProvider(),
      });
      const model = new ScriptedModel([
        { text: JSON.stringify(SPEC) },
        { text: JSON.stringify({ ...SPEC, name: "Second List" }) },
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
        allowDevBilling: true,
        countryCode: "US",
        now: () => now,
        builder: {
          build: (options) =>
            buildApp(
              { store, hosting, root, model, modelId: "scripted-model" },
              options,
            ),
        },
      });

      const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
        platform.fetch(
          input instanceof Request ? input : new Request(String(input), init),
        )) as unknown as typeof fetch;
      const client = new FreebuffClient({ baseUrl: ORIGIN, fetchImpl });
      const link = await client.requestMagicLink("Desktop@Example.com");
      await client.completeMagicLink(link.token);
      const challenge = await client.requestPhoneCode("+1 (415) 555-0199");
      await client.verifyPhone("+14155550199", challenge.code ?? "");

      const shell = createDesktopApp({ client, platformUrl: ORIGIN });
      const signedOut = createDesktopApp({
        client: new FreebuffClient({ baseUrl: ORIGIN, fetchImpl }),
        platformUrl: ORIGIN,
      });

      // 1. The landing page shows the account, quota meter and a labelled ad.
      const page = await shell.fetch(new Request(`${ORIGIN}/`));
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-store");
      const html = await page.text();
      expect(html).toContain("desktop@example.com");
      expect(html).toContain('class="sidebar"');
      expect(html).toContain('role="progressbar"');
      expect(html).toContain('class="sponsored-ad"');
      expect(html).toContain("Sponsored");
      expect(html).toContain("No apps yet");

      // 2. State is server-authoritative rather than rendered into a client cache.
      const state = (await (await shell.fetch(new Request(`${ORIGIN}/api/state`))).json()) as {
        email: string;
        plan: string;
        quota: { hoursPerDay: number };
        apps: unknown[];
      };
      expect(state.email).toBe("desktop@example.com");
      expect(state.plan).toBe("free");
      expect(state.quota.hoursPerDay).toBe(2);
      expect(state.apps).toHaveLength(0);

      // 3. A build goes through the platform and lands in the next render.
      const built = await shell.fetch(
        new Request(`${ORIGIN}/api/build`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "A reading list with a finished flag" }),
        }),
      );
      expect(built.status).toBe(201);
      const payload = (await built.json()) as {
        app: { id: string; name: string };
        url: string;
        timeline: unknown[];
      };
      expect(payload.app.name).toBe("Reading List");
      expect(payload.url).toContain("/s/");
      expect(payload.timeline.length).toBeGreaterThan(0);

      const afterBuild = await (await shell.fetch(new Request(`${ORIGIN}/`))).text();
      expect(afterBuild).toContain("Reading List");
      expect(afterBuild).toContain('class="app-card"');

      // 4. Quota is enforced by the server and surfaces as 429, not a rendered guess.
      advanceHour();
      const second = await shell.fetch(
        new Request(`${ORIGIN}/api/build`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "A second reading list" }),
        }),
      );
      expect(second.status).toBe(201);
      advanceHour();
      const limited = await shell.fetch(
        new Request(`${ORIGIN}/api/build`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "A third reading list" }),
        }),
      );
      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({ code: "quota_exceeded" });

      // 5. Malformed bodies, unknown routes and signed-out sessions are refused.
      const malformed = await shell.fetch(
        new Request(`${ORIGIN}/api/build`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        }),
      );
      expect(malformed.status).toBe(422);
      expect(await malformed.json()).toMatchObject({ code: "validation_failed" });

      const unknown = await shell.fetch(new Request(`${ORIGIN}/api/nope`));
      expect(unknown.status).toBe(404);

      const denied = await signedOut.fetch(new Request(`${ORIGIN}/`));
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ code: "unauthorized" });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
