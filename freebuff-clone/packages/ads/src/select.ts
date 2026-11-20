import { adSchema } from "@freebuff/shared";
import type { Ad, AdDecision, AdSlot, Plan } from "@freebuff/shared";
import { z } from "zod";

export const adInventorySchema = z.object({
  version: z.literal(1),
  ads: z.array(adSchema),
});
export type AdInventory = z.infer<typeof adInventorySchema>;

export interface AdSelectionInput {
  readonly slot: AdSlot;
  readonly plan: Plan;
  readonly topics: readonly string[];
  /** Stable per-session seed, so the same session shows a stable ad. */
  readonly seed: string;
}

const hashSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const weightedPick = (ads: readonly Ad[], random: () => number): Ad | undefined => {
  const total = ads.reduce((sum, ad) => sum + ad.weight, 0);
  if (total <= 0) {
    return undefined;
  }
  let point = random() * total;
  for (const ad of ads) {
    point -= ad.weight;
    if (point < 0) {
      return ad;
    }
  }
  return ads[ads.length - 1];
};

/**
 * Picks one sponsored slot for a free-tier user.
 *
 * Paid plans never see ads. Targeting uses topic labels derived locally from the
 * prompt embedding — never the prompt text. Selection is weighted and seeded, so
 * it is stable within a session and reproducible in tests.
 */
export const selectSponsoredAd = (
  input: AdSelectionInput,
  inventory: AdInventory,
): AdDecision | undefined => {
  if (input.plan === "paid") {
    return undefined;
  }
  const candidates = inventory.ads.filter(
    (ad) => ad.status === "active" && ad.slots.includes(input.slot),
  );
  if (candidates.length === 0) {
    return undefined;
  }
  const topics = new Set(input.topics.map((topic) => topic.toLowerCase()));
  const contextual = candidates.filter((ad) =>
    ad.topics.some((topic) => topics.has(topic.toLowerCase())),
  );
  const pool = contextual.length > 0 ? contextual : candidates;
  const ad = weightedPick(pool, mulberry32(hashSeed(input.seed)));
  if (ad === undefined) {
    return undefined;
  }
  return {
    slot: input.slot,
    ad,
    rationale: contextual.length > 0 ? "contextual" : "fallback",
  };
};

/** Plain-text rendering lives in ./render so every surface shares one label. */
