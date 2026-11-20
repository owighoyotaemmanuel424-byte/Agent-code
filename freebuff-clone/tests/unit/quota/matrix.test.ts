import { describe, expect, it } from "vitest";
import {
  defaultQuotaConfig,
  listCountryQuotas,
  resolveCountryQuota,
  resolveEntitlements,
  validateQuotaMatrix,
} from "@freebuff/quota";
import { quotaConfigSchema } from "@freebuff/shared";

const entry = (countryCode: string, timeZone: string) => ({
  countryCode,
  timeZone,
  freeHoursPerDay: 5,
  paidHoursPerDay: 10,
  updatedAt: "2026-11-19T00:00:00.000Z",
});

describe("country quota matrix", () => {
  it("publishes a valid matrix with no duplicate countries or unknown zones", () => {
    expect(defaultQuotaConfig.countries.length).toBeGreaterThanOrEqual(20);
    expect(validateQuotaMatrix(defaultQuotaConfig)).toEqual([]);
  });

  it("keeps the paid allowance at or above the free allowance everywhere", () => {
    for (const country of defaultQuotaConfig.countries) {
      expect(country.paidHoursPerDay).toBeGreaterThanOrEqual(
        country.freeHoursPerDay,
      );
      expect(country.timeZone.length).toBeGreaterThan(0);
    }
    expect(defaultQuotaConfig.default.paidHoursPerDay).toBeGreaterThanOrEqual(
      defaultQuotaConfig.default.freeHoursPerDay,
    );
  });

  it("exposes a deterministic, sorted view for UIs and the SDK", () => {
    const listed = listCountryQuotas(defaultQuotaConfig);
    const codes = listed.map((country) => country.countryCode);
    expect(codes).toEqual([...codes].sort((left, right) => left.localeCompare(right)));
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(defaultQuotaConfig.countries.length);

    const us = listed.find((country) => country.countryCode === "US");
    expect(us?.freeHoursPerDay).toBe(30);
    expect(us?.timeZone).toBe("America/New_York");
  });

  it("falls back to the default entry for an unlisted country", () => {
    const unknown = resolveCountryQuota(defaultQuotaConfig, "UG");
    expect(unknown).toEqual({
      countryCode: "UG",
      timeZone: "UTC",
      freeHoursPerDay: 5,
      paidHoursPerDay: 40,
    });
  });

  it("reports duplicates and unknown time zones", () => {
    const config = quotaConfigSchema.parse({
      version: 1,
      default: { timeZone: "UTC", freeHoursPerDay: 5, paidHoursPerDay: 40 },
      countries: [
        entry("US", "America/New_York"),
        entry("US", "America/New_York"),
        entry("GB", "Mars/Olympus"),
      ],
    });
    const problems = validateQuotaMatrix(config);
    expect(problems).toContain("Duplicate country entry: US");
    expect(problems).toContain("Unknown time zone for GB: Mars/Olympus");
    expect(problems).toHaveLength(2);
  });

  it("derives hours, ads and model access from the plan", () => {
    const us = resolveCountryQuota(defaultQuotaConfig, "US");
    expect(resolveEntitlements(us, "free")).toEqual({
      plan: "free",
      hoursPerDay: 30,
      adsEnabled: true,
      premiumModels: false,
    });
    expect(resolveEntitlements(us, "paid")).toEqual({
      plan: "paid",
      hoursPerDay: 60,
      adsEnabled: false,
      premiumModels: true,
    });
  });
});
