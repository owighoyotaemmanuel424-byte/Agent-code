/**
 * Local-day helpers. Quota days are calendar days in the user's configured
 * time zone; there is no rollover of unused hours between days.
 */
const dayFormatterCache = new Map<string, Intl.DateTimeFormat>();

const dayFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = dayFormatterCache.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dayFormatterCache.set(timeZone, formatter);
  return formatter;
};

/** Calendar day key (`YYYY-MM-DD`) for the given instant and zone. */
export const localDayKey = (date: Date, timeZone: string): string =>
  dayFormatter(timeZone).format(date);

const zonedParts = (
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number.parseInt(found.value, 10);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
};

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
export const timeZoneOffsetMs = (date: Date, timeZone: string): number => {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
};

/** The next local midnight strictly after `date`, in that time zone. */
export const nextLocalMidnight = (date: Date, timeZone: string): Date => {
  const [yearText, monthText, dayText] = localDayKey(date, timeZone).split("-");
  const year = Number.parseInt(yearText ?? "1970", 10);
  const month = Number.parseInt(monthText ?? "01", 10);
  const day = Number.parseInt(dayText ?? "01", 10);

  const nextDayStartUtc = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  // Two passes settle the offset even across a DST boundary.
  const firstGuess = nextDayStartUtc - timeZoneOffsetMs(new Date(nextDayStartUtc), timeZone);
  const offset = timeZoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(nextDayStartUtc - offset);
};

export const HOUR_MS = 3_600_000;
export const HOUR_SECONDS = 3600;
