import { sessionIdSchema } from "@freebuff/shared";
import type {
  Ad,
  AdDecision,
  AdImpression,
  AdSlot,
  Plan,
  SessionId,
  Surface,
} from "@freebuff/shared";
import { selectSponsoredAd } from "./select";
import type { AdInventory } from "./select";

/** Persistence boundary for impression and click accounting. */
export interface AdEventStore {
  recordImpression(impression: AdImpression): void;
  recordClick(impression: AdImpression): void;
  impressionCount(adId: string): number;
  clickCount(adId: string): number;
}

export interface AdStats {
  readonly adId: string;
  readonly impressions: number;
  readonly clicks: number;
}

export class InMemoryAdEventStore implements AdEventStore {
  private readonly impressions: AdImpression[] = [];
  private readonly clicks: AdImpression[] = [];

  recordImpression(impression: AdImpression): void {
    this.impressions.push(impression);
  }

  recordClick(impression: AdImpression): void {
    this.clicks.push(impression);
  }

  impressionCount(adId: string): number {
    return this.impressions.filter((impression) => impression.adId === adId).length;
  }

  clickCount(adId: string): number {
    return this.clicks.filter((click) => click.adId === adId).length;
  }

  countsByAd(): AdStats[] {
    const ids = new Set<string>([
      ...this.impressions.map((impression) => String(impression.adId)),
      ...this.clicks.map((click) => String(click.adId)),
    ]);
    return [...ids]
      .sort((left, right) => left.localeCompare(right))
      .map((adId) => ({
        adId,
        impressions: this.impressionCount(adId),
        clicks: this.clickCount(adId),
      }));
  }
}

export interface AdServeInput {
  readonly slot: AdSlot;
  readonly plan: Plan;
  readonly topics: readonly string[];
  readonly seed: string;
  readonly surface: Surface;
  readonly sessionId: SessionId;
}

export interface AdEngineOptions {
  readonly inventory: AdInventory;
  readonly store: AdEventStore;
  readonly now?: () => Date;
}

/**
 * Selection plus server-side accounting. Every impression is recorded with the
 * ad id, slot, surface, session and time only — never prompt text or code.
 * Paid plans get no decision and therefore no impression.
 */
export class AdEngine {
  private readonly inventory: AdInventory;
  private readonly store: AdEventStore;
  private readonly now: () => Date;

  constructor(options: AdEngineOptions) {
    this.inventory = options.inventory;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  serve(input: AdServeInput): AdDecision | undefined {
    const decision = selectSponsoredAd(
      {
        slot: input.slot,
        plan: input.plan,
        topics: input.topics,
        seed: input.seed,
      },
      this.inventory,
    );
    if (decision === undefined) {
      return undefined;
    }
    this.store.recordImpression({
      adId: decision.ad.id,
      slot: input.slot,
      surface: input.surface,
      sessionId: sessionIdSchema.parse(String(input.sessionId)),
      shownAt: this.now().toISOString(),
    });
    return decision;
  }

  /** Counts a click once for a decision that was previously served. */
  click(ad: Ad, input: Omit<AdServeInput, "plan" | "topics" | "seed">): void {
    this.store.recordClick({
      adId: ad.id,
      slot: input.slot,
      surface: input.surface,
      sessionId: sessionIdSchema.parse(String(input.sessionId)),
      shownAt: this.now().toISOString(),
    });
  }

  stats(ads: readonly Ad[]): AdStats[] {
    return ads.map((ad) => ({
      adId: String(ad.id),
      impressions: this.store.impressionCount(String(ad.id)),
      clicks: this.store.clickCount(String(ad.id)),
    }));
  }

  slotsCovered(): AdSlot[] {
    const covered = new Set<AdSlot>();
    for (const ad of this.inventory.ads) {
      if (ad.status !== "active") {
        continue;
      }
      for (const slot of ad.slots) {
        covered.add(slot);
      }
    }
    return [...covered].sort();
  }
}
