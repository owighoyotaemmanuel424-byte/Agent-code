import { AppError, newId, userIdSchema } from "@freebuff/shared";
import type { UserId } from "@freebuff/shared";
import type {
  BillingCheckout,
  BillingCheckoutInput,
  BillingEvent,
  BillingProvider,
} from "./subscriptions";

interface PendingCheckout {
  readonly userId: UserId;
  readonly createdAt: number;
}

const CHECKOUT_TTL_MS = 15 * 60 * 1000;

/**
 * Development-only provider: no card is charged and checkouts complete through
 * an explicit local endpoint. It exists so the paid tier can be exercised in
 * tests and on a laptop; production deployments must configure Stripe.
 */
export class LocalBillingProvider implements BillingProvider {
  readonly kind = "local";
  private readonly pending = new Map<string, PendingCheckout>();
  private readonly now: () => Date;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createCheckout(input: BillingCheckoutInput): Promise<BillingCheckout> {
    const reference = `local_${newId()}`;
    this.pending.set(reference, {
      userId: userIdSchema.parse(String(input.userId)),
      createdAt: this.now().getTime(),
    });
    const url = new URL(input.successUrl);
    url.searchParams.set("local_checkout", reference);
    return {
      url: url.toString(),
      reference,
      expiresAt: new Date(this.now().getTime() + CHECKOUT_TTL_MS).toISOString(),
    };
  }

  async parseWebhook(): Promise<BillingEvent> {
    throw new AppError({
      code: "forbidden",
      message: "The local billing provider does not accept webhooks",
    });
  }

  completeReference(reference: string): BillingEvent {
    const pending = this.pending.get(reference);
    if (pending === undefined) {
      throw new AppError({
        code: "not_found",
        message: "Unknown checkout reference",
      });
    }
    const age = this.now().getTime() - pending.createdAt;
    this.pending.delete(reference);
    if (age > CHECKOUT_TTL_MS) {
      throw new AppError({
        code: "unauthorized",
        message: "This checkout has expired",
      });
    }
    return {
      type: "subscription.activated",
      userId: pending.userId,
      reference,
    };
  }
}
