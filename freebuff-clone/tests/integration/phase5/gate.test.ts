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
import { ScriptedModel } from "../../support/scripted-model";

const ORIGIN = "http://phase5.test";
const SECRET = "phase5-secret-that-is-at-least-32-characters";
const HOUR_SECONDS = 3600;
const MINUTE_MS = 60 * 1000;

const SMALL_QUOTA: QuotaConfig = {
  version: 1,
  default: { timeZone: "UTC", freeHoursPerDay: 2, paidHoursPerDay: 8 },
  countries: [],
};

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

const jsonRequest = (url: string, body: unknown, token?: string): Request =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

describe("Phase 5 gate: monetization across the web surface", () => {
  it("gates builds on verification and quota, then lifts them for a paid account", async () => {
    const root = await mkdtemp(join(tmpdir(), "freebuff-phase5-"));
    const db = openSqliteDatabase(join(root, "platform.sqlite"));
    let now = new Date("2026-11-19T12:00:00.000Z");
    const advance = (ms: number): void => {
      now = new Date(now.getTime() + ms);
    };

    try {
      const store = new PlatformStore({ db });
      const authStore = new SqliteAuthStore({ db });
      const auth = new AuthService({ store: authStore, secret: SECRET });
      const hosting = new LocalHostingAdapter({ root });
      const runtime = new AppRuntime({ root, store });
      const quota = new QuotaService({
        store: new SqliteQuotaStore({ db }),
        config: SMALL_QUOTA,
        now: () => now,
      });
      const adStore = new SqliteAdEventStore({ db });
      const ads = new AdEngine({
        inventory: defaultAdInventory,
        store: adStore,
        now: () => now,
      });
      const phone = new PhoneVerificationService({
        store: authStore,
        authStore,
        secret: SECRET,
        now: () => now,
      });
      const provider = new LocalBillingProvider({ now: () => now });
      const subscriptions = new SubscriptionService({
        authStore,
        store: new SqliteSubscriptionStore({ db }),
        provider,
        now: () => now,
      });
      const model = new ScriptedModel([
        { text: JSON.stringify(SPEC) },
        { text: JSON.stringify(SPEC) },
        { text: JSON.stringify({ ...SPEC, name: "Paid Plan App" }) },
      ]);
      const buildPlans: string[] = [];

      const app = createWebApp({
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
          build: (options) => {
            buildPlans.push(options.plan);
            return buildApp(
              {
                store,
                hosting,
                root,
                model,
                modelId: "scripted-model",
                now: () => now,
              },
              options,
            );
          },
        },
      });

      const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
        app.fetch(
          input instanceof Request ? input : new Request(String(input), init),
        )) as unknown as typeof fetch;
      const client = new FreebuffClient({ baseUrl: ORIGIN, fetchImpl });

      // 1. Free-tier advertising is labelled on the landing page and over the API.
      const landing = await app.fetch(new Request(`${ORIGIN}/`));
      expect(landing.status).toBe(200);
      const landingHtml = await landing.text();
      expect(landingHtml).toContain('class="sponsored-ad"');
      expect(landingHtml).toContain("Sponsored");

      const publicAdResponse = await app.fetch(
        new Request(`${ORIGIN}/api/ads?slot=web.builder&surface=web&session=anon-1`),
      );
      expect(publicAdResponse.status).toBe(200);
      const publicAd = (await publicAdResponse.json()) as {
        decision: { ad: { id: string; label: string } } | null;
        label: string;
        plan: string;
      };
      expect(publicAd.label).toBe("Sponsored");
      expect(publicAd.plan).toBe("free");
      if (publicAd.decision === null) {
        throw new Error("expected a sponsored decision for a free visitor");
      }
      expect(publicAd.decision.ad.label).toBe("Sponsored");
      expect(adStore.impressionCount(publicAd.decision.ad.id)).toBeGreaterThan(0);

      // 2. An anonymous build is refused: the server owns quota.
      const anonymous = await app.fetch(
        new Request(`${ORIGIN}/api/apps`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "An anonymous app" }),
        }),
      );
      expect(anonymous.status).toBe(401);

      // 3. Sign in through the SDK and read the server snapshot.
      const link = await client.requestMagicLink("Maker@Example.com");
      const session = await client.completeMagicLink(link.token);
      expect(session.user.email).toBe("maker@example.com");
      const signedIn = await client.me();
      expect(signedIn.plan).toBe("free");
      expect(signedIn.phoneVerified).toBe(false);

      const blockedSnapshot = await client.quota();
      expect(blockedSnapshot.decision.allowed).toBe(false);
      expect(
        blockedSnapshot.decision.allowed === false && blockedSnapshot.decision.reason,
      ).toBe("phone_verification_required");
      expect(blockedSnapshot.snapshot.adsEnabled).toBe(true);

      await expect(client.buildApp("A recipe box")).rejects.toMatchObject({
        code: "verification_required",
      });
      expect(buildPlans).toHaveLength(0);

      // 4. Phone verification: wrong code refused, dev code accepted.
      const challenge = await client.requestPhoneCode("+1 (415) 555-0123");
      expect(challenge.delivery).toBe("dev");
      expect(challenge.phone).toBe("+14155550123");
      expect(challenge.code).toMatch(/^\d{6}$/);
      const code = challenge.code ?? "";
      const wrongCode = code === "000000" ? "111111" : "000000";
      await expect(client.verifyPhone("+14155550123", wrongCode)).rejects.toMatchObject({
        code: "unauthorized",
      });
      await client.verifyPhone("+14155550123", code);
      expect((await client.me()).phoneVerified).toBe(true);

      // 5. Two builds spend the two free hours; the third is refused with 429.
      const first = await client.buildApp("A recipe box with favourites");
      expect(first.app.status).toBe("deployed");
      expect(first.url).toMatch(/^http:\/\/phase5\.test\/s\/.+\/$/);
      expect((await client.listApps())).toHaveLength(1);

      const afterFirst = await client.quota();
      expect(afterFirst.snapshot.hoursPerDay).toBe(2);
      expect(afterFirst.snapshot.consumedSecondsToday).toBe(HOUR_SECONDS);

      advance(61 * MINUTE_MS);
      const second = await client.buildApp("A recipe box for two cooks");
      expect(second.app.id).not.toBe(first.app.id);
      expect((await client.quota()).snapshot.consumedSecondsToday).toBe(2 * HOUR_SECONDS);
      expect(buildPlans).toEqual(["free", "free"]);

      advance(61 * MINUTE_MS);
      await expect(client.buildApp("A third recipe box")).rejects.toMatchObject({
        code: "quota_exceeded",
      });
      const limited = await app.fetch(
        jsonRequest(`${ORIGIN}/api/apps`, { prompt: "A third recipe box" }, client.sessionToken),
      );
      expect(limited.status).toBe(429);
      const limitedBody = (await limited.json()) as {
        code: string;
        message: string;
        retryable: boolean;
      };
      expect(limitedBody.code).toBe("quota_exceeded");
      expect(limitedBody.retryable).toBe(false);
      expect(limitedBody.message).toContain("resets at");
      expect((await client.quota()).decision.allowed).toBe(false);

      // 6. Local checkout upgrades the account, removes ads and raises the allowance.
      expect(await client.billingStatus()).toMatchObject({ plan: "free" });
      const checkout = await client.startCheckout();
      expect(checkout.url).toContain("local_checkout=");
      expect(await client.completeLocalCheckout(checkout.reference)).toBe("paid");
      expect((await client.me()).plan).toBe("paid");
      const status = await client.billingStatus();
      expect(status.subscription?.status).toBe("active");
      expect(status.subscription?.provider).toBe("local");

      const paidAd = await client.ads({ slot: "web.builder", session: "paid-session" });
      expect(paidAd.decision).toBeNull();
      expect(paidAd.label).toBe("Sponsored");

      const paidBuild = await client.buildApp("An app for a paying customer");
      expect(paidBuild.app.status).toBe("deployed");
      expect(buildPlans).toEqual(["free", "free", "paid"]);

      const paidSnapshot = await client.quota();
      expect(paidSnapshot.snapshot.plan).toBe("paid");
      expect(paidSnapshot.snapshot.hoursPerDay).toBe(8);
      expect(paidSnapshot.snapshot.adsEnabled).toBe(false);
      expect(paidSnapshot.snapshot.consumedSecondsToday).toBe(3 * HOUR_SECONDS);

      // 7. Hours reset at local midnight and never roll over.
      now = new Date("2026-11-20T12:00:00.000Z");
      const nextDay = await client.quota();
      expect(nextDay.snapshot.consumedSecondsToday).toBe(0);
      expect(Date.parse(nextDay.snapshot.resetsAt)).toBeGreaterThan(now.getTime());

      // 8. Apps built by an account stay with that account.
      const intruder = new FreebuffClient({ baseUrl: ORIGIN, fetchImpl });
      const intruderLink = await intruder.requestMagicLink("intruder@example.com");
      await intruder.completeMagicLink(intruderLink.token);
      expect(await intruder.listApps()).toHaveLength(0);
      await expect(intruder.getApp(first.app.id)).rejects.toMatchObject({
        code: "forbidden",
      });
      expect((await client.listApps())).toHaveLength(3);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
