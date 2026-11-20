import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuthStore,
  InMemorySubscriptionStore,
  LocalBillingProvider,
  StripeBillingProvider,
  SubscriptionService,
} from "@freebuff/auth";
import type { BillingProvider, BillingEvent } from "@freebuff/auth";
import { userIdSchema } from "@freebuff/shared";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const WEBHOOK_SECRET = "whsec_test_secret_value";
const STRIPE_SECRET = "sk_test_secret_value_123";
const STRIPE_USER = userIdSchema.parse("11111111-1111-4111-8111-111111111111");

const setupLocal = async () => {
  let now = NOW;
  const authStore = new InMemoryAuthStore();
  const user = await authStore.createUser("dev@example.com");
  const provider = new LocalBillingProvider({ now: () => now });
  const store = new InMemorySubscriptionStore();
  const service = new SubscriptionService({
    authStore,
    store,
    provider,
    now: () => now,
  });
  return {
    authStore,
    user,
    provider,
    store,
    service,
    advance: (ms: number): void => {
      now = new Date(now.getTime() + ms);
    },
  };
};

const stripeProvider = (fetchImpl?: typeof fetch): StripeBillingProvider =>
  new StripeBillingProvider({
    secretKey: STRIPE_SECRET,
    priceId: "price_123",
    webhookSecret: WEBHOOK_SECRET,
    apiBaseUrl: "https://stripe.test",
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });

const sign = (body: string, timestamp: number): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(`${String(timestamp)}.${body}`).digest("hex");

const signatureHeader = (body: string, timestamp: number): string =>
  `t=${String(timestamp)},v1=${sign(body, timestamp)}`;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

describe("local billing provider", () => {
  it("creates a checkout reference and activates the paid plan on completion", async () => {
    const { service, authStore, user, store } = await setupLocal();

    const checkout = await service.checkout({
      userId: user.id,
      successUrl: "https://app.test/?billing=success",
      cancelUrl: "https://app.test/?billing=cancel",
    });
    expect(checkout.reference.startsWith("local_")).toBe(true);
    expect(checkout.url).toContain(`local_checkout=${checkout.reference}`);

    const event = await service.completeLocalCheckout(checkout.reference);
    expect(event.type).toBe("subscription.activated");
    expect((await authStore.findUserById(user.id))?.plan).toBe("paid");

    const record = await store.get(user.id);
    expect(record?.status).toBe("active");
    expect(record?.provider).toBe("local");
    expect(await service.record(user.id)).toMatchObject({ plan: "paid" });
  });

  it("rejects unknown and expired checkout references", async () => {
    const { provider, advance } = await setupLocal();
    expect(() => provider.completeReference("local_unknown")).toThrow(/Unknown checkout/);

    const checkout = await provider.createCheckout({
      userId: (await (await setupLocal()).user).id,
      successUrl: "https://app.test/",
      cancelUrl: "https://app.test/",
    });
    advance(16 * 60 * 1000);
    expect(() => provider.completeReference(checkout.reference)).toThrow(/expired/);
  });

  it("does not accept webhooks or complete checkouts on a Stripe deployment", async () => {
    const local = await setupLocal();
    await expect(
      local.service.handleWebhook({ rawBody: "{}", headers: {} }),
    ).rejects.toThrow(/does not accept webhooks/);

    const authStore = new InMemoryAuthStore();
    const user = await authStore.createUser("dev@example.com");
    const stripeService = new SubscriptionService({
      authStore,
      store: new InMemorySubscriptionStore(),
      provider: stripeProvider(),
    });
    await expect(stripeService.completeLocalCheckout("ref")).rejects.toThrow(
      /not available/,
    );
    expect((await authStore.findUserById(user.id))?.plan).toBe("free");
  });
});

describe("stripe billing provider", () => {
  it("creates a checkout session over the REST API without an SDK", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.test/cs" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const provider = stripeProvider(fetchImpl);

    const checkout = await provider.createCheckout({
      userId: STRIPE_USER,
      successUrl: "https://app.test/?ok=1",
      cancelUrl: "https://app.test/?cancel=1",
    });
    expect(checkout).toMatchObject({ reference: "cs_test_1", url: "https://checkout.test/cs" });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) {
      throw new Error("expected a provider call");
    }
    expect(call.url).toBe("https://stripe.test/v1/checkout/sessions");
    expect(call.init?.method).toBe("POST");
    const body = String(call.init?.body ?? "");
    expect(body).toContain("mode=subscription");
    expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_123");
    expect(body).toContain(`client_reference_id=${String(STRIPE_USER)}`);
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${STRIPE_SECRET}`);
  });

  it("maps provider failures to a sanitized error", async () => {
    const provider = stripeProvider(
      (async () =>
        new Response("upstream exploded", { status: 500 })) as unknown as typeof fetch,
    );
    const checkoutInput = {
      userId: STRIPE_USER,
      successUrl: "https://app.test/",
      cancelUrl: "https://app.test/",
    };
    await expect(provider.createCheckout(checkoutInput)).rejects.toMatchObject({
      code: "provider_error",
    });
    await expect(provider.createCheckout(checkoutInput)).rejects.toThrow(/HTTP 500/);
    await expect(provider.createCheckout(checkoutInput)).rejects.not.toThrow(
      new RegExp(STRIPE_SECRET),
    );
  });

  it("requires a key, a price and a webhook secret", () => {
    expect(
      () =>
        new StripeBillingProvider({
          secretKey: "short",
          priceId: "price_123",
          webhookSecret: WEBHOOK_SECRET,
        }),
    ).toThrow(/secret key/);
    expect(
      () =>
        new StripeBillingProvider({
          secretKey: STRIPE_SECRET,
          priceId: "price_123",
          webhookSecret: "tiny",
        }),
    ).toThrow(/webhook secret/);
  });

  it("accepts only signatures it can verify within the tolerance window", async () => {
    const provider = stripeProvider();
    const userId = "11111111-1111-4111-8111-111111111111";
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1", client_reference_id: userId } },
    });

    const event = await provider.parseWebhook({
      rawBody: body,
      headers: { "stripe-signature": signatureHeader(body, nowSeconds()) },
    });
    expect(event).toEqual({
      type: "subscription.activated",
      userId,
      reference: "cs_test_1",
    });

    await expect(
      provider.parseWebhook({ rawBody: body, headers: {} }),
    ).rejects.toThrow(/Missing webhook signature/);

    await expect(
      provider.parseWebhook({
        rawBody: body,
        headers: { "stripe-signature": signatureHeader(body, nowSeconds() - 600) },
      }),
    ).rejects.toThrow(/tolerance/);

    const tampered = body.replace("cs_test_1", "cs_test_2");
    await expect(
      provider.parseWebhook({
        rawBody: tampered,
        headers: { "stripe-signature": signatureHeader(body, nowSeconds()) },
      }),
    ).rejects.toThrow(/does not match/);
  });

  it("ignores unrelated events and cancellations without a user reference", async () => {
    const provider = stripeProvider();
    const timestamp = nowSeconds();
    const parse = async (payload: unknown): Promise<BillingEvent> => {
      const body = JSON.stringify(payload);
      return provider.parseWebhook({
        rawBody: body,
        headers: { "stripe-signature": signatureHeader(body, timestamp) },
      });
    };

    expect(
      await parse({ id: "evt_2", type: "invoice.paid", data: { object: {} } }),
    ).toEqual({ type: "ignored", reason: "unhandled event invoice.paid" });
    expect(
      await parse({
        id: "evt_3",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_1", metadata: {} } },
      }),
    ).toEqual({ type: "ignored", reason: "cancellation without a user reference" });
    expect(
      await parse({
        id: "evt_4",
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_9" } },
      }),
    ).toEqual({ type: "ignored", reason: "checkout without a user reference" });
  });

  it("activates and then cancels the plan through signed webhooks", async () => {
    const provider = stripeProvider();
    const authStore = new InMemoryAuthStore();
    const user = await authStore.createUser("dev@example.com");
    const store = new InMemorySubscriptionStore();
    const service = new SubscriptionService({ authStore, store, provider });
    const timestamp = nowSeconds();

    const post = async (payload: unknown): Promise<BillingEvent> => {
      const body = JSON.stringify(payload);
      return service.handleWebhook({
        rawBody: body,
        headers: { "stripe-signature": signatureHeader(body, timestamp) },
      });
    };

    await post({
      id: "evt_5",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_5", client_reference_id: user.id } },
    });
    expect((await authStore.findUserById(user.id))?.plan).toBe("paid");
    expect((await store.get(user.id))?.status).toBe("active");

    await post({
      id: "evt_6",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_5", metadata: { userId: user.id } } },
    });
    expect((await authStore.findUserById(user.id))?.plan).toBe("free");
    expect((await store.get(user.id))?.status).toBe("canceled");
  });
});

describe("billing provider boundary", () => {
  it("exposes the provider kind used for auditing", async () => {
    const { service } = await setupLocal();
    const kind: BillingProvider["kind"] = service.providerKind;
    expect(kind).toBe("local");
  });
});
