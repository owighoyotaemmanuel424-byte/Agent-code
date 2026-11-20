import { describe, expect, it } from "vitest";
import {
  HOUR_SECONDS,
  InMemoryQuotaStore,
  QuotaService,
  evaluateQuota,
  localDayKey,
  nextLocalMidnight,
  resolveCountryQuota,
} from "@freebuff/quota";
import { defaultQuotaConfig } from "@freebuff/quota";
import { quotaConfigSchema, userIdSchema } from "@freebuff/shared";

const userId = userIdSchema.parse("11111111-1111-4111-8111-111111111111");
const US = resolveCountryQuota(defaultQuotaConfig, "US");
const NOW = new Date("2026-11-19T15:00:00.000Z");

describe("quota configuration", () => {
  it("uses the configured US allowance and falls back to the default", () => {
    expect(US.freeHoursPerDay).toBe(30);
    const unknown = resolveCountryQuota(defaultQuotaConfig, "ZZ");
    expect(unknown.freeHoursPerDay).toBe(5);
    expect(unknown.countryCode).toBe("ZZ");
  });

  it("rejects a paid allowance below the free allowance", () => {
    expect(() =>
      quotaConfigSchema.parse({
        version: 1,
        default: { timeZone: "UTC", freeHoursPerDay: 10, paidHoursPerDay: 5 },
        countries: [],
      }),
    ).toThrow();
  });
});

describe("local day handling", () => {
  it("computes the calendar day in the configured zone", () => {
    expect(localDayKey(new Date("2026-11-19T03:00:00.000Z"), "America/New_York")).toBe(
      "2026-11-18",
    );
    expect(nextLocalMidnight(NOW, "UTC").toISOString()).toBe(
      "2026-11-20T00:00:00.000Z",
    );
  });
});

describe("quota evaluation", () => {
  it("allows a verified free user with remaining hours", () => {
    const { decision, snapshot } = evaluateQuota({
      userId,
      plan: "free",
      phoneVerified: true,
      countryCode: "US",
      record: undefined,
      quota: US,
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    expect(snapshot.hoursPerDay).toBe(30);
    expect(snapshot.adsEnabled).toBe(true);
    expect(snapshot.activeHourStartedAt).toBeUndefined();
  });

  it("requires phone verification on the free tier", () => {
    const { decision } = evaluateQuota({
      userId,
      plan: "free",
      phoneVerified: false,
      countryCode: "US",
      record: undefined,
      quota: US,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe(
      "phone_verification_required",
    );
  });

  it("resets usage when the local day changes and never rolls hours over", () => {
    const yesterday = {
      userId,
      plan: "free" as const,
      countryCode: "US",
      dayKey: "2026-11-18",
      consumedSeconds: 30 * HOUR_SECONDS,
      phoneVerified: true,
      suspended: false,
    };
    const { decision, snapshot } = evaluateQuota({
      userId,
      plan: "free",
      phoneVerified: true,
      countryCode: "US",
      record: yesterday,
      quota: US,
      now: NOW,
    });
    expect(snapshot.consumedSecondsToday).toBe(0);
    expect(decision.allowed).toBe(true);
  });

  it("denies when fewer than a full hour remains", () => {
    const { decision } = evaluateQuota({
      userId,
      plan: "free",
      phoneVerified: true,
      countryCode: "US",
      record: {
        userId,
        plan: "free",
        countryCode: "US",
        dayKey: localDayKey(NOW, US.timeZone),
        consumedSeconds: 30 * HOUR_SECONDS - 60,
        phoneVerified: true,
        suspended: false,
      },
      quota: US,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe("quota_exhausted");
  });

  it("gives paid plans a larger allowance and no ads", () => {
    const { snapshot } = evaluateQuota({
      userId,
      plan: "paid",
      phoneVerified: true,
      countryCode: "US",
      record: undefined,
      quota: US,
      now: NOW,
    });
    expect(snapshot.hoursPerDay).toBe(60);
    expect(snapshot.adsEnabled).toBe(false);
  });
});

describe("quota service", () => {
  it("charges one hour once, then reuses the active hour", async () => {
    let now = NOW;
    const store = new InMemoryQuotaStore();
    const service = new QuotaService({ store, now: () => now });
    const subject = {
      userId,
      plan: "free" as const,
      countryCode: "US",
      phoneVerified: true,
    };

    const first = await service.beginHour(subject);
    expect(first.decision.allowed).toBe(true);
    expect(first.snapshot.consumedSecondsToday).toBe(HOUR_SECONDS);
    expect(first.snapshot.activeHourStartedAt).toBe(NOW.toISOString());

    now = new Date(NOW.getTime() + 10 * 60 * 1000);
    const second = await service.beginHour(subject);
    expect(second.snapshot.consumedSecondsToday).toBe(HOUR_SECONDS);

    now = new Date(NOW.getTime() + 61 * 60 * 1000);
    const third = await service.beginHour(subject);
    expect(third.snapshot.consumedSecondsToday).toBe(2 * HOUR_SECONDS);
    expect(third.snapshot.activeHourStartedAt).toBe(now.toISOString());
  });

  it("stops charging once the daily allowance is spent", async () => {
    const store = new InMemoryQuotaStore();
    let now = new Date("2026-11-19T05:00:00.000Z");
    const service = new QuotaService({
      store,
      now: () => now,
      config: {
        version: 1,
        default: { timeZone: "UTC", freeHoursPerDay: 2, paidHoursPerDay: 10 },
        countries: [],
      },
    });
    const subject = {
      userId,
      plan: "free" as const,
      countryCode: "GB",
      phoneVerified: true,
    };

    expect((await service.beginHour(subject)).decision.allowed).toBe(true);
    for (let hour = 0; hour < 3; hour += 1) {
      now = new Date(now.getTime() + 61 * 60 * 1000);
      await service.beginHour(subject);
    }
    const blocked = await service.beginHour(subject);
    expect(blocked.decision.allowed).toBe(false);
    expect(blocked.snapshot.consumedSecondsToday).toBe(2 * HOUR_SECONDS);
  });
});
