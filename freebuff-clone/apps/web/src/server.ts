import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthService,
  LocalBillingProvider,
  PhoneVerificationService,
  StripeBillingProvider,
  SubscriptionService,
} from "@freebuff/auth";
import type { BillingProvider } from "@freebuff/auth";
import { AdEngine, defaultAdInventory } from "@freebuff/ads";
import { openSqliteDatabase } from "@freebuff/db";
import { QuotaService } from "@freebuff/quota";
import { buildApp } from "./builder";
import { createWebApp } from "./app";
import { SqliteAuthStore } from "./auth-store";
import { LocalHostingAdapter } from "./hosting";
import { createModelFromEnv, defaultModelIdOf, modelForPlan } from "./model";
import {
  SqliteAdEventStore,
  SqliteQuotaStore,
  SqliteSubscriptionStore,
} from "./phase5-store";
import { AppRuntime } from "./runtime";
import { PlatformStore } from "./store";

const root =
  process.env["FREEBUFF_WEB_ROOT"] ?? join(tmpdir(), "freebuff-web");

const secretFromEnv = process.env["FREEBUFF_AUTH_SECRET"];
const secret =
  secretFromEnv !== undefined && secretFromEnv.length >= 32
    ? secretFromEnv
    : randomBytes(32).toString("hex");
if (secretFromEnv === undefined) {
  process.stderr.write(
    "FREEBUFF_AUTH_SECRET is not set; using an ephemeral secret (sessions end on restart).\n",
  );
}

const selectBillingProvider = (): BillingProvider | undefined => {
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const priceId = process.env["STRIPE_PRICE_ID"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (
    secretKey !== undefined &&
    secretKey.length > 0 &&
    priceId !== undefined &&
    priceId.length > 0 &&
    webhookSecret !== undefined &&
    webhookSecret.length > 0
  ) {
    return new StripeBillingProvider({ secretKey, priceId, webhookSecret });
  }
  if (process.env["FREEBUFF_ALLOW_LOCAL_BILLING"] === "1") {
    process.stderr.write(
      "Billing: local development provider enabled; no card is charged.\n",
    );
    return new LocalBillingProvider();
  }
  return undefined;
};

await mkdir(root, { recursive: true });
const db = openSqliteDatabase(join(root, "platform.sqlite"));
const store = new PlatformStore({ db });
const authStore = new SqliteAuthStore({ db });
const auth = new AuthService({ store: authStore, secret });
const hosting = new LocalHostingAdapter({ root });
const runtime = new AppRuntime({ root, store });

const quota = new QuotaService({ store: new SqliteQuotaStore({ db }) });
const ads = new AdEngine({
  inventory: defaultAdInventory,
  store: new SqliteAdEventStore({ db }),
});
const phone = new PhoneVerificationService({
  store: authStore,
  authStore,
  secret,
});
const billingProvider = selectBillingProvider();
const subscriptions =
  billingProvider === undefined
    ? undefined
    : new SubscriptionService({
        authStore,
        store: new SqliteSubscriptionStore({ db }),
        provider: billingProvider,
      });

const resolved = createModelFromEnv(process.env);

const app = createWebApp({
  store,
  auth,
  runtime,
  root,
  quota,
  ads,
  phone,
  countryCode: process.env["FREEBUFF_COUNTRY_CODE"] ?? "US",
  ...(subscriptions === undefined
    ? {}
    : {
        subscriptions,
        allowDevBilling: billingProvider?.kind === "local",
      }),
  modelReady: resolved !== undefined,
  ...(resolved === undefined ? {} : { modelId: defaultModelIdOf(resolved) }),
  ...(resolved === undefined
    ? {}
    : {
        builder: {
          build: (buildOptions) => {
            const selected = modelForPlan(resolved, buildOptions.plan);
            if (selected === undefined) {
              throw new Error(
                `No model is available for the ${buildOptions.plan} plan`,
              );
            }
            return buildApp(
              {
                store,
                hosting,
                root,
                model: selected.model,
                modelId: selected.modelId,
              },
              buildOptions,
            );
          },
        },
      }),
});

const port = Number.parseInt(process.env["PORT"] ?? "3002", 10);
Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });
process.stdout.write(
  `freebuff web builder on http://0.0.0.0:${String(port)} (data: ${root}, model: ${resolved?.defaultModelId ?? "none"}, billing: ${billingProvider?.kind ?? "none"})\n`,
);
