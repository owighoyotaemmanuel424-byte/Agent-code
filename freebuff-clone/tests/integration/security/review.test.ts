import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthService,
  PhoneVerificationService,
  StripeBillingProvider,
  SubscriptionService,
} from "@freebuff/auth";
import { AdEngine, defaultAdInventory } from "@freebuff/ads";
import { openSqliteDatabase } from "@freebuff/db";
import { QuotaService } from "@freebuff/quota";
import { createWebApp } from "../../../apps/web/src/app";
import { SqliteAuthStore } from "../../../apps/web/src/auth-store";
import {
  SqliteAdEventStore,
  SqliteQuotaStore,
  SqliteSubscriptionStore,
} from "../../../apps/web/src/phase5-store";
import { AppRuntime } from "../../../apps/web/src/runtime";
import { appSpecSchema } from "../../../apps/web/src/spec";
import { PlatformStore } from "../../../apps/web/src/store";

const ORIGIN = "http://security.test";
const SECRET = "security-secret-that-is-at-least-32-chars";
const WEBHOOK_SECRET = "whsec_security_review_secret";

const SPEC = appSpecSchema.parse({
  name: "Ledger",
  tagline: "Track what you spend",
  theme: { primary: "#111111", accent: "#22aa66", radius: 8, dark: true },
  entities: [
    {
      name: "entries",
      label: "Entries",
      fields: [{ name: "memo", label: "Memo", type: "text", required: true }],
    },
  ],
});

const jsonRequest = (url: string, body: unknown, token?: string): Request =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

const sign = (body: string, timestamp: number): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(`${String(timestamp)}.${body}`).digest("hex");

describe("security review: Phase 5 surfaces", () => {
  it("keeps plans, ads, credentials and account data server-owned", async () => {
    const root = await mkdtemp(join(tmpdir(), "freebuff-security-"));
    const db = openSqliteDatabase(join(root, "platform.sqlite"));
    try {
      const store = new PlatformStore({ db });
      const authStore = new SqliteAuthStore({ db });
      const auth = new AuthService({ store: authStore, secret: SECRET });
      const runtime = new AppRuntime({ root, store });
      const quota = new QuotaService({ store: new SqliteQuotaStore({ db }) });
      const ads = new AdEngine({
        inventory: defaultAdInventory,
        store: new SqliteAdEventStore({ db }),
      });
      const phone = new PhoneVerificationService({
        store: authStore,
        authStore,
        secret: SECRET,
      });
      const subscriptions = new SubscriptionService({
        authStore,
        store: new SqliteSubscriptionStore({ db }),
        provider: new StripeBillingProvider({
          secretKey: "sk_test_security_review",
          priceId: "price_security_review",
          webhookSecret: WEBHOOK_SECRET,
        }),
      });

      const app = createWebApp({
        store,
        auth,
        runtime,
        root,
        quota,
        ads,
        phone,
        subscriptions,
        allowDevBilling: false,
        countryCode: "US",
      });

      const signIn = async (email: string): Promise<string> => {
        const requested = await app.fetch(
          jsonRequest(`${ORIGIN}/api/auth/magic/request`, { email }),
        );
        expect(requested.status).toBe(200);
        const { token } = (await requested.json()) as { token: string };
        const completed = await app.fetch(
          jsonRequest(`${ORIGIN}/api/auth/magic/complete`, { token }),
        );
        expect(completed.status).toBe(200);
        return ((await completed.json()) as { sessionToken: string }).sessionToken;
      };

      const owner = await signIn("owner@example.com");
      const intruder = await signIn("intruder@example.com");
      const ownerUser = await auth.verifySession(owner);

      // --- billing webhook is the only path to a paid plan -----------------
      const pendingUpgrade = await app.fetch(
        new Request(`${ORIGIN}/api/billing/webhook`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "checkout.session.completed" }),
        }),
      );
      expect(pendingUpgrade.status).toBe(401);
      expect(((await pendingUpgrade.json()) as { code: string }).code).toBe("unauthorized");

      const eventBody = JSON.stringify({
        id: "evt_security_1",
        type: "checkout.session.completed",
        data: {
          object: { id: "cs_security_1", client_reference_id: String(ownerUser.id) },
        },
      });
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600;
      const stale = await app.fetch(
        new Request(`${ORIGIN}/api/billing/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": `t=${String(staleTimestamp)},v1=${sign(eventBody, staleTimestamp)}`,
          },
          body: eventBody,
        }),
      );
      expect(stale.status).toBe(401);

      const timestamp = Math.floor(Date.now() / 1000);
      const verified = await app.fetch(
        new Request(`${ORIGIN}/api/billing/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": `t=${String(timestamp)},v1=${sign(eventBody, timestamp)}`,
          },
          body: eventBody,
        }),
      );
      expect(verified.status).toBe(200);
      expect(await verified.json()).toEqual({ received: "subscription.activated" });

      const ownerMe = await app.fetch(
        new Request(`${ORIGIN}/api/me`, { headers: { authorization: `Bearer ${owner}` } }),
      );
      expect(((await ownerMe.json()) as { user: { plan: string } }).user.plan).toBe("paid");

      const devComplete = await app.fetch(
        jsonRequest(`${ORIGIN}/api/billing/dev/complete`, { reference: "cs_security_1" }, owner),
      );
      expect(devComplete.status).toBe(404);

      // --- impersonation is refused ---------------------------------------
      const appId = "11111111-1111-4111-8111-111111111111";
      store.createApp({
        id: appId,
        slug: "ledger-security",
        prompt: "A ledger",
        spec: SPEC,
        createdAt: new Date().toISOString(),
        inputTokens: 10,
        outputTokens: 20,
        ownerId: String(ownerUser.id),
      });

      const readOwn = await app.fetch(
        new Request(`${ORIGIN}/api/apps/${appId}`, {
          headers: { authorization: `Bearer ${owner}` },
        }),
      );
      expect(readOwn.status).toBe(200);

      const readStolen = await app.fetch(
        new Request(`${ORIGIN}/api/apps/${appId}`, {
          headers: { authorization: `Bearer ${intruder}` },
        }),
      );
      expect(readStolen.status).toBe(403);

      const ejectStolen = await app.fetch(
        new Request(`${ORIGIN}/api/apps/${appId}/eject`, {
          headers: { authorization: `Bearer ${intruder}` },
        }),
      );
      expect(ejectStolen.status).toBe(403);

      const ownerList = await app.fetch(
        new Request(`${ORIGIN}/api/apps`, { headers: { authorization: `Bearer ${owner}` } }),
      );
      expect(((await ownerList.json()) as { apps: unknown[] }).apps).toHaveLength(1);
      const intruderList = await app.fetch(
        new Request(`${ORIGIN}/api/apps`, { headers: { authorization: `Bearer ${intruder}` } }),
      );
      expect(((await intruderList.json()) as { apps: unknown[] }).apps).toHaveLength(0);

      // --- verification codes are stored hashed, never in plaintext --------
      const requestedCode = await app.fetch(
        jsonRequest(`${ORIGIN}/api/auth/phone/request`, { phone: "+14155550123" }, owner),
      );
      expect(requestedCode.status).toBe(200);
      const challenge = (await requestedCode.json()) as { code?: string; delivery: string };
      expect(challenge.delivery).toBe("dev");
      const code = challenge.code ?? "";
      const stored = db
        .prepare("SELECT code_hash FROM phone_challenges WHERE phone = ?")
        .get(["+14155550123"]);
      expect(stored?.["code_hash"]).toBeDefined();
      expect(String(stored?.["code_hash"])).not.toBe(code);
      expect(String(stored?.["code_hash"])).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(db.prepare("SELECT * FROM phone_challenges").all([]))).not.toContain(
        `"${code}"`,
      );

      // --- ad targeting never echoes prompt or topic text ------------------
      const adResponse = await app.fetch(
        new Request(
          `${ORIGIN}/api/ads?slot=web.builder&topics=confidential-project-name&session=session-1`,
        ),
      );
      const adBody = await adResponse.text();
      expect(adResponse.status).toBe(200);
      expect(adBody).toContain('"label":"Sponsored"');
      expect(adBody).not.toContain("confidential-project-name");
      expect(adResponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(adResponse.headers.get("cache-control")).toBe("no-store");

      // --- error and header hygiene ---------------------------------------
      const missing = await app.fetch(new Request(`${ORIGIN}/api/does-not-exist`));
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        error: "not_found",
        code: "not_found",
        message: "Unknown route",
        retryable: false,
      });

      const badToken = await app.fetch(
        new Request(`${ORIGIN}/api/me`, { headers: { authorization: "Bearer not-a-token" } }),
      );
      expect(badToken.status).toBe(401);
      expect(await badToken.json()).toEqual({
        error: "unauthorized",
        code: "unauthorized",
        message: "Not signed in",
        retryable: false,
      });
      expect(badToken.headers.get("x-content-type-options")).toBe("nosniff");
      expect(badToken.headers.get("cache-control")).toBe("no-store");

      const oversized = await app.fetch(
        jsonRequest(`${ORIGIN}/api/auth/magic/request`, {
          email: "a".repeat(1_100_000),
        }),
      );
      expect(oversized.status).toBe(422);
      expect(((await oversized.json()) as { code: string }).code).toBe("validation_failed");
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
