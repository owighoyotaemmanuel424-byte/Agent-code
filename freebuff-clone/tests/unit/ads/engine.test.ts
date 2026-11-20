import { describe, expect, it } from "vitest";
import {
  AdEngine,
  InMemoryAdEventStore,
  SPONSORED_LABEL,
  defaultAdInventory,
  formatSponsoredAd,
  sponsoredAdHtml,
  sponsoredBadge,
} from "@freebuff/ads";
import type { AdEventStore } from "@freebuff/ads";
import { adSchema, sessionIdSchema } from "@freebuff/shared";
import type { Ad, AdImpression } from "@freebuff/shared";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const SESSION = sessionIdSchema.parse("session-1");

const engine = () => {
  const store = new InMemoryAdEventStore();
  return {
    store,
    engine: new AdEngine({
      inventory: defaultAdInventory,
      store,
      now: () => NOW,
    }),
  };
};

class RecordingStore implements AdEventStore {
  readonly impressions: AdImpression[] = [];
  readonly clicks: AdImpression[] = [];

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
}

describe("ad inventory", () => {
  it("covers every surface slot with labelled HTTPS inventory", () => {
    const { engine: adEngine } = engine();
    expect(adEngine.slotsCovered()).toEqual([
      "cli.session",
      "cli.startup",
      "cloud.dashboard",
      "desktop.sidebar",
      "web.builder",
    ]);
    for (const ad of defaultAdInventory.ads) {
      expect(ad.label).toBe(SPONSORED_LABEL);
      expect(ad.destinationUrl.startsWith("https://")).toBe(true);
    }
    expect(new Set(defaultAdInventory.ads.map((ad) => ad.id)).size).toBe(
      defaultAdInventory.ads.length,
    );
  });
});

describe("ad engine", () => {
  it("serves a labelled ad to free users and records the impression", () => {
    const { engine: adEngine, store } = engine();
    const decision = adEngine.serve({
      slot: "web.builder",
      plan: "free",
      topics: [],
      seed: "landing",
      surface: "web",
      sessionId: SESSION,
    });
    expect(decision).toBeDefined();
    expect(decision?.ad.label).toBe(SPONSORED_LABEL);
    if (decision === undefined) {
      throw new Error("expected a decision");
    }
    expect(store.impressionCount(String(decision.ad.id))).toBe(1);
    expect(store.clickCount(String(decision.ad.id))).toBe(0);

    adEngine.serve({
      slot: "web.builder",
      plan: "free",
      topics: [],
      seed: "landing",
      surface: "web",
      sessionId: SESSION,
    });
    expect(store.impressionCount(String(decision.ad.id))).toBe(2);
  });

  it("never serves or records an ad for the paid tier", () => {
    const { engine: adEngine, store } = engine();
    const decision = adEngine.serve({
      slot: "cli.session",
      plan: "paid",
      topics: ["agents"],
      seed: "paid",
      surface: "cli",
      sessionId: SESSION,
    });
    expect(decision).toBeUndefined();
    const stats = adEngine.stats(defaultAdInventory.ads);
    expect(stats.every((entry) => entry.impressions === 0)).toBe(true);
    expect(store.impressionCount("ad-observability")).toBe(0);
  });

  it("counts clicks once and reports per-ad stats", () => {
    const { engine: adEngine, store } = engine();
    const decision = adEngine.serve({
      slot: "cli.session",
      plan: "free",
      topics: ["observability"],
      seed: "cli",
      surface: "cli",
      sessionId: SESSION,
    });
    if (decision === undefined) {
      throw new Error("expected a decision");
    }
    adEngine.click(decision.ad, {
      slot: "cli.session",
      surface: "cli",
      sessionId: SESSION,
    });
    expect(store.clickCount(String(decision.ad.id))).toBe(1);
    const stats = adEngine.stats([decision.ad]);
    expect(stats[0]).toEqual({
      adId: String(decision.ad.id),
      impressions: 1,
      clicks: 1,
    });
  });

  it("records identifiers only, never prompt text or code", () => {
    const store = new RecordingStore();
    const adEngine = new AdEngine({
      inventory: defaultAdInventory,
      store,
      now: () => NOW,
    });
    adEngine.serve({
      slot: "web.builder",
      plan: "free",
      topics: ["private-project-name"],
      seed: "session",
      surface: "web",
      sessionId: SESSION,
    });
    expect(store.impressions).toHaveLength(1);
    const impression = store.impressions[0];
    if (impression === undefined) {
      throw new Error("expected an impression");
    }
    expect(Object.keys(impression).sort()).toEqual([
      "adId",
      "sessionId",
      "shownAt",
      "slot",
      "surface",
    ]);
    expect(JSON.stringify(impression)).not.toContain("private-project-name");
  });
});

describe("sponsored rendering", () => {
  const ad = defaultAdInventory.ads[0];
  if (ad === undefined) {
    throw new Error("inventory fixture is empty");
  }

  it("puts the literal Sponsored label first in every renderer", () => {
    const lines = formatSponsoredAd(ad);
    expect(lines[0]?.startsWith(`${SPONSORED_LABEL} · `)).toBe(true);
    expect(lines.join(" ")).toContain(ad.headline);
    expect(sponsoredBadge(ad)).toBe(`[${SPONSORED_LABEL}] ${ad.headline}`);
    expect(sponsoredAdHtml(ad)).toContain(
      `<span class="sponsored-label">${SPONSORED_LABEL}</span>`,
    );
  });

  it("escapes ad content and marks the link sponsored", () => {
    const hostile: Ad = adSchema.parse({
      ...ad,
      id: "ad-hostile",
      headline: "<script>alert(1)</script>",
      body: "Quotes \" and & ampersands",
    });
    const html = sponsoredAdHtml(hostile);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain('rel="sponsored noopener noreferrer"');
    expect(html).toContain('data-ad-id="ad-hostile"');
  });

  it("refuses to render inventory that lost its label", () => {
    const unlabelled = {
      ...ad,
      label: "Advertisement" as unknown as Ad["label"],
    };
    expect(() => formatSponsoredAd(unlabelled)).toThrow(/Sponsored label/);
    expect(() => sponsoredAdHtml(unlabelled)).toThrow(/Sponsored label/);
    expect(() => sponsoredBadge(unlabelled)).toThrow(/Sponsored label/);
  });
});
