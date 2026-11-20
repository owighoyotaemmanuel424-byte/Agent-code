import { describe, expect, it } from "vitest";
import { adInventorySchema, formatSponsoredAd, selectSponsoredAd } from "@freebuff/ads";
import { newId } from "@freebuff/shared";

const inventory = adInventorySchema.parse({
  version: 1,
  ads: [
    {
      id: newId(),
      advertiser: "Trace Co",
      headline: "Trace every agent run",
      body: "Spans, cost and latency in one view.",
      destinationUrl: "https://example.com/traces",
      label: "Sponsored",
      topics: ["observability", "agents"],
      slots: ["cli.session"],
      status: "active",
      weight: 10,
    },
    {
      id: newId(),
      advertiser: "Deploy Co",
      headline: "Ship previews in seconds",
      body: "Ephemeral environments per branch.",
      destinationUrl: "https://example.com/deploy",
      label: "Sponsored",
      topics: ["deploy"],
      slots: ["cli.session"],
      status: "active",
      weight: 5,
    },
    {
      id: newId(),
      advertiser: "Paused Co",
      headline: "Never shown",
      body: "Paused inventory.",
      destinationUrl: "https://example.com/paused",
      label: "Sponsored",
      topics: [],
      slots: ["cli.session"],
      status: "paused",
      weight: 100,
    },
  ],
});

describe("sponsored ad selection", () => {
  it("never shows ads on the paid tier", () => {
    expect(
      selectSponsoredAd(
        { slot: "cli.session", plan: "paid", topics: ["agents"], seed: "s1" },
        inventory,
      ),
    ).toBeUndefined();
  });

  it("prefers contextual inventory for free users", () => {
    const decision = selectSponsoredAd(
      { slot: "cli.session", plan: "free", topics: ["observability"], seed: "s1" },
      inventory,
    );
    expect(decision?.rationale).toBe("contextual");
    expect(decision?.ad.advertiser).toBe("Trace Co");
  });

  it("falls back to any active inventory when topics do not match", () => {
    const decision = selectSponsoredAd(
      { slot: "cli.session", plan: "free", topics: ["gardening"], seed: "s1" },
      inventory,
    );
    expect(decision?.rationale).toBe("fallback");
    expect(["Trace Co", "Deploy Co"]).toContain(decision?.ad.advertiser);
  });

  it("is stable for a session seed", () => {
    const input = {
      slot: "cli.session" as const,
      plan: "free" as const,
      topics: [] as string[],
      seed: "stable-session",
    };
    const first = selectSponsoredAd(input, inventory)?.ad.id;
    const second = selectSponsoredAd(input, inventory)?.ad.id;
    expect(first).toBe(second);
  });

  it("returns nothing when no active inventory serves the slot", () => {
    expect(
      selectSponsoredAd(
        { slot: "cloud.dashboard", plan: "free", topics: [], seed: "s" },
        inventory,
      ),
    ).toBeUndefined();
  });

  it("always labels rendered ads as Sponsored", () => {
    const ad = inventory.ads[0];
    if (ad === undefined) {
      throw new Error("fixture missing");
    }
    const lines = formatSponsoredAd(ad);
    expect(lines[0]?.startsWith("Sponsored")).toBe(true);
    expect(lines.join(" ")).toContain(ad.headline);
  });
});
