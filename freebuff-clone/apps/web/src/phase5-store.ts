import type { SqlDatabase } from "@freebuff/db";
import type { SubscriptionRecord, SubscriptionStore } from "@freebuff/auth";
import type { AdEventStore } from "@freebuff/ads";
import type { QuotaStore, QuotaUsageRecord } from "@freebuff/quota";
import {
  adSlotSchema,
  planSchema,
  sessionIdSchema,
  surfaceSchema,
  userIdSchema,
} from "@freebuff/shared";
import type { AdImpression, Plan, UserId } from "@freebuff/shared";

/** Durable quota state. One row per account; the service owns all writes. */
export class SqliteQuotaStore implements QuotaStore {
  private readonly db: SqlDatabase;

  constructor(options: { readonly db: SqlDatabase }) {
    this.db = options.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quota_usage (
        user_id TEXT PRIMARY KEY,
        plan TEXT NOT NULL,
        country_code TEXT NOT NULL,
        day_key TEXT NOT NULL,
        consumed_seconds INTEGER NOT NULL,
        active_hour_started_at TEXT,
        phone_verified INTEGER NOT NULL,
        suspended INTEGER NOT NULL
      );
    `);
  }

  async get(userId: UserId): Promise<QuotaUsageRecord | undefined> {
    const row = this.db
      .prepare("SELECT * FROM quota_usage WHERE user_id = ?")
      .get([String(userId)]);
    if (row === undefined) {
      return undefined;
    }
    const active = row["active_hour_started_at"];
    return {
      userId: userIdSchema.parse(String(row["user_id"])),
      plan: planSchema.parse(String(row["plan"])),
      countryCode: String(row["country_code"]),
      dayKey: String(row["day_key"]),
      consumedSeconds: Number(row["consumed_seconds"]),
      ...(active === null || active === undefined
        ? {}
        : { activeHourStartedAt: String(active) }),
      phoneVerified: Number(row["phone_verified"]) === 1,
      suspended: Number(row["suspended"]) === 1,
    };
  }

  async put(record: QuotaUsageRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO quota_usage
           (user_id, plan, country_code, day_key, consumed_seconds, active_hour_started_at, phone_verified, suspended)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           plan = excluded.plan,
           country_code = excluded.country_code,
           day_key = excluded.day_key,
           consumed_seconds = excluded.consumed_seconds,
           active_hour_started_at = excluded.active_hour_started_at,
           phone_verified = excluded.phone_verified,
           suspended = excluded.suspended`,
      )
      .run([
        String(record.userId),
        record.plan,
        record.countryCode,
        record.dayKey,
        record.consumedSeconds,
        record.activeHourStartedAt ?? null,
        record.phoneVerified ? 1 : 0,
        record.suspended ? 1 : 0,
      ]);
  }
}

/** Impression and click accounting; identifiers only, never prompt content. */
export class SqliteAdEventStore implements AdEventStore {
  private readonly db: SqlDatabase;

  constructor(options: { readonly db: SqlDatabase }) {
    this.db = options.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ad_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        ad_id TEXT NOT NULL,
        slot TEXT NOT NULL,
        surface TEXT NOT NULL,
        session_id TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ad_events_ad ON ad_events(ad_id, kind);
    `);
  }

  private record(kind: "impression" | "click", impression: AdImpression): void {
    this.db
      .prepare(
        `INSERT INTO ad_events (kind, ad_id, slot, surface, session_id, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run([
        kind,
        String(impression.adId),
        adSlotSchema.parse(impression.slot),
        surfaceSchema.parse(impression.surface),
        String(sessionIdSchema.parse(String(impression.sessionId))),
        impression.shownAt,
      ]);
  }

  recordImpression(impression: AdImpression): void {
    this.record("impression", impression);
  }

  recordClick(impression: AdImpression): void {
    this.record("click", impression);
  }

  private count(adId: string, kind: "impression" | "click"): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM ad_events WHERE ad_id = ? AND kind = ?")
      .get([adId, kind]);
    return Number(row?.["total"] ?? 0);
  }

  impressionCount(adId: string): number {
    return this.count(adId, "impression");
  }

  clickCount(adId: string): number {
    return this.count(adId, "click");
  }
}

export class SqliteSubscriptionStore implements SubscriptionStore {
  private readonly db: SqlDatabase;

  constructor(options: { readonly db: SqlDatabase }) {
    this.db = options.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id TEXT PRIMARY KEY,
        plan TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        reference TEXT NOT NULL,
        current_period_end TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async get(userId: UserId): Promise<SubscriptionRecord | undefined> {
    const row = this.db
      .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
      .get([String(userId)]);
    if (row === undefined) {
      return undefined;
    }
    const periodEnd = row["current_period_end"];
    return {
      userId: userIdSchema.parse(String(row["user_id"])),
      plan: planSchema.parse(String(row["plan"])) as Plan,
      status: String(row["status"]) === "active" ? "active" : "canceled",
      provider: String(row["provider"]),
      reference: String(row["reference"]),
      ...(periodEnd === null || periodEnd === undefined
        ? {}
        : { currentPeriodEnd: String(periodEnd) }),
      updatedAt: String(row["updated_at"]),
    };
  }

  async put(record: SubscriptionRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO subscriptions
           (user_id, plan, status, provider, reference, current_period_end, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           plan = excluded.plan,
           status = excluded.status,
           provider = excluded.provider,
           reference = excluded.reference,
           current_period_end = excluded.current_period_end,
           updated_at = excluded.updated_at`,
      )
      .run([
        String(record.userId),
        record.plan,
        record.status,
        record.provider,
        record.reference,
        record.currentPeriodEnd ?? null,
        record.updatedAt,
      ]);
  }
}
