import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, userIdSchema } from "@freebuff/shared";
import type { UserId } from "@freebuff/shared";
import type {
  BillingCheckout,
  BillingCheckoutInput,
  BillingEvent,
  BillingProvider,
} from "./subscriptions";

export interface StripeBillingOptions {
  readonly secretKey: string;
  readonly priceId: string;
  readonly webhookSecret: string;
  /** Defaults to the public API; tests point this at a local server. */
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Webhook timestamp tolerance. Defaults to five minutes. */
  readonly toleranceSeconds?: number;
}

const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const parseSignature = (
  header: string,
): { timestamp: number; signatures: string[] } | undefined => {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        timestamp = parsed;
      }
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  return timestamp === undefined || signatures.length === 0
    ? undefined
    : { timestamp, signatures };
};

const hexMatches = (expected: string, provided: string): boolean => {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Checkout sessions and subscription webhooks over Stripe's REST API. No SDK is
 * required: the request is form-encoded and the webhook is verified locally with
 * HMAC-SHA256, so only a signature-verified event can change a plan.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly kind = "stripe";
  private readonly secretKey: string;
  private readonly priceId: string;
  private readonly webhookSecret: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly toleranceSeconds: number;

  constructor(options: StripeBillingOptions) {
    if (options.secretKey.length < 8 || options.priceId.length < 3) {
      throw new AppError({
        code: "validation_failed",
        message: "Stripe billing requires a secret key and a price id",
      });
    }
    if (options.webhookSecret.length < 8) {
      throw new AppError({
        code: "validation_failed",
        message: "Stripe billing requires a webhook secret",
      });
    }
    this.secretKey = options.secretKey;
    this.priceId = options.priceId;
    this.webhookSecret = options.webhookSecret;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.stripe.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.toleranceSeconds = options.toleranceSeconds ?? 300;
  }

  async createCheckout(input: BillingCheckoutInput): Promise<BillingCheckout> {
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("line_items[0][price]", this.priceId);
    form.set("line_items[0][quantity]", "1");
    form.set("client_reference_id", String(input.userId));
    form.set("subscription_data[metadata][userId]", String(input.userId));
    form.set("success_url", input.successUrl);
    form.set("cancel_url", input.cancelUrl);

    const response = await this.fetchImpl(`${this.apiBaseUrl}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": "2024-06-20",
      },
      body: form.toString(),
    }).catch((cause: unknown) => {
      throw new AppError({
        code: "provider_error",
        message: "Could not reach the billing provider",
        cause,
      });
    });

    if (!response.ok) {
      throw new AppError({
        code: "provider_error",
        message: `Billing provider rejected checkout (HTTP ${String(response.status)})`,
      });
    }
    const body = objectOf(await response.json());
    const url = stringOf(body?.["url"]);
    const reference = stringOf(body?.["id"]);
    if (url === undefined || reference === undefined) {
      throw new AppError({
        code: "provider_error",
        message: "Billing provider returned an unexpected checkout response",
      });
    }
    return {
      url,
      reference,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async parseWebhook(input: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
  }): Promise<BillingEvent> {
    const header = input.headers["stripe-signature"];
    if (header === undefined) {
      throw new AppError({
        code: "unauthorized",
        message: "Missing webhook signature",
      });
    }
    const parsed = parseSignature(header);
    if (parsed === undefined) {
      throw new AppError({
        code: "unauthorized",
        message: "Malformed webhook signature",
      });
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - parsed.timestamp) > this.toleranceSeconds) {
      throw new AppError({
        code: "unauthorized",
        message: "Webhook timestamp is outside the tolerance window",
      });
    }

    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${String(parsed.timestamp)}.${input.rawBody}`)
      .digest("hex");
    if (!parsed.signatures.some((signature) => hexMatches(expected, signature))) {
      throw new AppError({
        code: "unauthorized",
        message: "Webhook signature does not match",
      });
    }

    let event: unknown;
    try {
      event = JSON.parse(input.rawBody);
    } catch {
      throw new AppError({
        code: "validation_failed",
        message: "Webhook body must be valid JSON",
      });
    }
    const envelope = objectOf(event);
    const type = stringOf(envelope?.["type"]);
    const data = objectOf(envelope?.["data"]);
    const object = objectOf(data?.["object"]);
    if (type === undefined || object === undefined) {
      throw new AppError({
        code: "validation_failed",
        message: "Webhook payload is missing its event object",
      });
    }

    if (type === "checkout.session.completed") {
      const reference = stringOf(object["id"]);
      const rawUser = stringOf(object["client_reference_id"]);
      const parsedUser = rawUser === undefined ? undefined : userIdSchema.safeParse(rawUser);
      if (reference === undefined || parsedUser === undefined || !parsedUser.success) {
        return { type: "ignored", reason: "checkout without a user reference" };
      }
      const userId: UserId = parsedUser.data;
      return {
        type: "subscription.activated",
        userId,
        reference,
      };
    }

    if (type === "customer.subscription.deleted") {
      const metadata = objectOf(object["metadata"]);
      const rawUser = stringOf(metadata?.["userId"]);
      const parsedUser = rawUser === undefined ? undefined : userIdSchema.safeParse(rawUser);
      if (parsedUser === undefined || !parsedUser.success) {
        return { type: "ignored", reason: "cancellation without a user reference" };
      }
      return {
        type: "subscription.canceled",
        userId: parsedUser.data,
        ...(stringOf(object["id"]) === undefined
          ? {}
          : { reference: stringOf(object["id"]) as string }),
      };
    }

    return { type: "ignored", reason: `unhandled event ${type}` };
  }
}
