import type { Plan, QuotaConfig, UserId } from "@freebuff/shared";
import { defaultQuotaConfig, resolveCountryQuota } from "./config";
import { evaluateQuota } from "./evaluate";
import type { QuotaEvaluation, QuotaUsageRecord } from "./evaluate";
import { HOUR_SECONDS, localDayKey } from "./time";

export interface QuotaStore {
  get(userId: UserId): Promise<QuotaUsageRecord | undefined>;
  put(record: QuotaUsageRecord): Promise<void>;
}

export class InMemoryQuotaStore implements QuotaStore {
  private readonly records = new Map<string, QuotaUsageRecord>();

  async get(userId: UserId): Promise<QuotaUsageRecord | undefined> {
    return this.records.get(String(userId));
  }

  async put(record: QuotaUsageRecord): Promise<void> {
    this.records.set(String(record.userId), record);
  }
}

export interface QuotaSubject {
  readonly userId: UserId;
  readonly plan: Plan;
  readonly countryCode: string;
  readonly phoneVerified: boolean;
}

export interface QuotaServiceOptions {
  readonly store: QuotaStore;
  readonly config?: QuotaConfig;
  readonly now?: () => Date;
}

/**
 * Server-side quota authority. The CLI renders its snapshots, but only this
 * service decides whether a model call may start.
 *
 * One "active hour" is charged up front, and every message inside it is free.
 * Hours belong to a local calendar day and are never carried forward.
 */
export class QuotaService {
  private readonly store: QuotaStore;
  private readonly config: QuotaConfig;
  private readonly now: () => Date;

  constructor(options: QuotaServiceOptions) {
    this.store = options.store;
    this.config = options.config ?? defaultQuotaConfig;
    this.now = options.now ?? (() => new Date());
  }

  async snapshot(subject: QuotaSubject): Promise<QuotaEvaluation> {
    const now = this.now();
    const quota = resolveCountryQuota(this.config, subject.countryCode);
    const record = await this.store.get(subject.userId);
    return evaluateQuota({
      userId: subject.userId,
      plan: subject.plan,
      phoneVerified: subject.phoneVerified,
      countryCode: subject.countryCode,
      record,
      quota,
      now,
    });
  }

  /** Opens (and charges) an hour, or reuses the current active hour. */
  async beginHour(subject: QuotaSubject): Promise<QuotaEvaluation> {
    const now = this.now();
    const quota = resolveCountryQuota(this.config, subject.countryCode);
    const existing = await this.store.get(subject.userId);
    const evaluation = evaluateQuota({
      userId: subject.userId,
      plan: subject.plan,
      phoneVerified: subject.phoneVerified,
      countryCode: subject.countryCode,
      record: existing,
      quota,
      now,
    });

    if (!evaluation.decision.allowed) {
      return evaluation;
    }

    const today = localDayKey(now, quota.timeZone);
    const alreadyActive = evaluation.snapshot.activeHourStartedAt !== undefined;
    if (alreadyActive) {
      return evaluation;
    }

    await this.store.put({
      userId: subject.userId,
      plan: subject.plan,
      countryCode: subject.countryCode,
      dayKey: today,
      consumedSeconds:
        evaluation.snapshot.consumedSecondsToday + HOUR_SECONDS,
      activeHourStartedAt: now.toISOString(),
      phoneVerified: subject.phoneVerified,
      suspended: existing?.suspended ?? false,
    });

    return this.snapshot(subject);
  }
}
