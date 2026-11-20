import { quotaConfigSchema } from "@freebuff/shared";
import type { QuotaConfig } from "@freebuff/shared";
import quotaConfigJson from "../config/quota.json";

/**
 * Quota policy is loaded from configuration so changing a country's allowance
 * never touches runtime code.
 */
export const defaultQuotaConfig: QuotaConfig = quotaConfigSchema.parse(quotaConfigJson);

export interface ResolvedQuota {
  readonly countryCode: string;
  readonly timeZone: string;
  readonly freeHoursPerDay: number;
  readonly paidHoursPerDay: number;
}

export const resolveCountryQuota = (
  config: QuotaConfig,
  countryCode: string,
): ResolvedQuota => {
  const match = config.countries.find(
    (country) => country.countryCode === countryCode,
  );
  if (match !== undefined) {
    return {
      countryCode: match.countryCode,
      timeZone: match.timeZone,
      freeHoursPerDay: match.freeHoursPerDay,
      paidHoursPerDay: match.paidHoursPerDay,
    };
  }
  return {
    countryCode,
    timeZone: config.default.timeZone,
    freeHoursPerDay: config.default.freeHoursPerDay,
    paidHoursPerDay: config.default.paidHoursPerDay,
  };
};

export interface QuotaMatrixEntry extends ResolvedQuota {
  readonly updatedAt: string;
}

/** Deterministic, sorted view of the country matrix for UIs and the SDK. */
export const listCountryQuotas = (config: QuotaConfig): QuotaMatrixEntry[] =>
  [...config.countries]
    .sort((left, right) => left.countryCode.localeCompare(right.countryCode))
    .map((country) => ({
      countryCode: country.countryCode,
      timeZone: country.timeZone,
      freeHoursPerDay: country.freeHoursPerDay,
      paidHoursPerDay: country.paidHoursPerDay,
      updatedAt: country.updatedAt,
    }));

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Structural checks the schema cannot express (duplicate countries, unknown
 * time zones). Returns human-readable problems; empty means the matrix is
 * publishable.
 */
export const validateQuotaMatrix = (config: QuotaConfig): string[] => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const country of config.countries) {
    if (seen.has(country.countryCode)) {
      problems.push(`Duplicate country entry: ${country.countryCode}`);
    }
    seen.add(country.countryCode);
    if (!isValidTimeZone(country.timeZone)) {
      problems.push(
        `Unknown time zone for ${country.countryCode}: ${country.timeZone}`,
      );
    }
  }
  if (!isValidTimeZone(config.default.timeZone)) {
    problems.push(`Unknown default time zone: ${config.default.timeZone}`);
  }
  return problems;
};
