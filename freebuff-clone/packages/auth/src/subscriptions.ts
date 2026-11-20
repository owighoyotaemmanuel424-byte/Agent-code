import { AppError, planSchema, userIdSchema } from "@freebuff/shared";
import type { Plan, UserId } from "@freebuff/shared";
import type { AuthStore } from "./service";

export interface BillingCheckout {
  readonly url: string;
  readonly reference: string;
  readonly expiresAt: string;
}

export interface BillingCheckoutInput {
  readonly userId: UserId;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

/**
 * Result of a verified provider event. `ignored` events are acknowledged so the
 * provider stops retrying, but they never change a plan.
 */
export type BillingEvent =
  | {
      readonly type: "subscription.activated";
      readonly userId: UserId;
      readonly reference: string;
      readonly currentPeriodEnd?: string;
    }
  | {
      readonly type: "subscription.canceled";
      readonly userId: UserId;
      readonly reference?: string;
    }
  | { readonly type: "ignored"; readonly reason: string };

/**
 * Payment providers implement this boundary. Checkout URLs are always produced
 * server-side from a fixed price, and plan changes arrive only through a
 * signature-verified webhook — never from a request body.
 */
export interface BillingProvider {
  readonly kind: "stripe" | "local";
  createCheckout(input: BillingCheckoutInput): Promise<BillingCheckout>;
  parseWebhook(input: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
  }): Promise<BillingEvent>;
  /** Development-only providers may complete a checkout without a webhook. */
  completeReference?(reference: string): BillingEvent;
}

export interface SubscriptionRecord {
  readonly userId: UserId;
  readonly plan: Plan;
  readonly status: "active" | "canceled";
  readonly provider: string;
  readonly reference: string;
  readonly currentPeriodEnd?: string;
  readonly updatedAt: string;
}

export interface SubscriptionStore {
  get(userId: UserId): Promise<SubscriptionRecord | undefined>;
  put(record: SubscriptionRecord): Promise<void>;
}

export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly records = new Map<string, SubscriptionRecord>();

  async get(userId: UserId): Promise<SubscriptionRecord | undefined> {
    return this.records.get(String(userId));
  }

  async put(record: SubscriptionRecord): Promise<void> {
    this.records.set(String(record.userId), record);
  }
}

export interface SubscriptionServiceOptions {
  readonly authStore: AuthStore;
  readonly store: SubscriptionStore;
  readonly provider: BillingProvider;
  readonly now?: () => Date;
}

/**
 * Owns the free → paid transition. The only write that raises a plan is a
 * provider event that passed signature verification.
 */
export class SubscriptionService {
  private readonly authStore: AuthStore;
  private readonly store: SubscriptionStore;
  private readonly provider: BillingProvider;
  private readonly now: () => Date;

  constructor(options: SubscriptionServiceOptions) {
    this.authStore = options.authStore;
    this.store = options.store;
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
  }

  get providerKind(): BillingProvider["kind"] {
    return this.provider.kind;
  }

  async checkout(input: {
    readonly userId: UserId;
    readonly successUrl: string;
    readonly cancelUrl: string;
  }): Promise<BillingCheckout> {
    return this.provider.createCheckout({
      userId: userIdSchema.parse(String(input.userId)),
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
  }

  async handleWebhook(input: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
  }): Promise<BillingEvent> {
    const event = await this.provider.parseWebhook(input);
    if (event.type === "ignored") {
      return event;
    }
    const now = this.now().toISOString();
    if (event.type === "subscription.activated") {
      await this.authStore.setPlan(event.userId, "paid");
      await this.store.put({
        userId: event.userId,
        plan: "paid",
        status: "active",
        provider: this.provider.kind,
        reference: event.reference,
        ...(event.currentPeriodEnd === undefined
          ? {}
          : { currentPeriodEnd: event.currentPeriodEnd }),
        updatedAt: now,
      });
      return event;
    }
    await this.authStore.setPlan(event.userId, "free");
    await this.store.put({
      userId: event.userId,
      plan: "free",
      status: "canceled",
      provider: this.provider.kind,
      reference: event.reference ?? "",
      updatedAt: now,
    });
    return event;
  }

  async record(
    userId: UserId,
  ): Promise<{ readonly plan: Plan; readonly subscription?: SubscriptionRecord }> {
    const subscription = await this.store.get(userId);
    return {
      plan: planSchema.parse(subscription?.plan ?? "free"),
      ...(subscription === undefined ? {} : { subscription }),
    };
  }

  /** Local checkout completion. Only the local provider exposes this path. */
  async completeLocalCheckout(
    reference: string,
  ): Promise<BillingEvent> {
    if (this.provider.kind !== "local") {
      throw new AppError({
        code: "forbidden",
        message: "Local checkout completion is not available",
      });
    }
    if (this.provider.completeReference === undefined) {
      throw new AppError({
        code: "internal",
        message: "Billing provider cannot complete local checkouts",
      });
    }
    const event = this.provider.completeReference(reference);
    if (event.type === "ignored") {
      return event;
    }
    if (event.type === "subscription.activated") {
      await this.authStore.setPlan(event.userId, "paid");
      await this.store.put({
        userId: event.userId,
        plan: "paid",
        status: "active",
        provider: this.provider.kind,
        reference: event.reference,
        ...(event.currentPeriodEnd === undefined
          ? {}
          : { currentPeriodEnd: event.currentPeriodEnd }),
        updatedAt: this.now().toISOString(),
      });
    }
    return event;
  }
}
