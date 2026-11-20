import { AppError, newId, nowIso, planSchema, timestampSchema, userIdSchema } from "@freebuff/shared";
import type {
  AuthStore,
  AuthUserRecord,
  MagicLinkRecord,
  PhoneChallengeRecord,
  PhoneStore,
  SessionRecord,
} from "@freebuff/auth";
import type { QuotaStore, QuotaUsageRecord } from "@freebuff/quota";
import type { UserId } from "@freebuff/shared";
import { z } from "zod";
import { readTextFile, writeFileAtomic } from "./fs-utils";

const userRecordSchema = z.object({
  id: userIdSchema,
  email: z.string().min(1),
  plan: planSchema,
  phoneVerified: z.boolean(),
  createdAt: timestampSchema,
});

const sessionRecordSchema = z.object({
  tokenHash: z.string().min(1),
  userId: userIdSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});

const magicLinkRecordSchema = z.object({
  tokenHash: z.string().min(1),
  email: z.string().min(1),
  expiresAt: timestampSchema,
});

const phoneChallengeRecordSchema = z.object({
  phone: z.string().min(1),
  userId: userIdSchema,
  codeHash: z.string().min(1),
  expiresAt: timestampSchema,
  attempts: z.number().int().nonnegative(),
  sentAt: timestampSchema,
});

const quotaRecordSchema = z.object({
  userId: userIdSchema,
  plan: planSchema,
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  dayKey: z.string().min(1),
  consumedSeconds: z.number().int().nonnegative(),
  activeHourStartedAt: timestampSchema.optional(),
  phoneVerified: z.boolean(),
  suspended: z.boolean(),
});

const platformStateSchema = z.object({
  version: z.literal(1),
  users: z.array(userRecordSchema),
  sessions: z.array(sessionRecordSchema),
  magicLinks: z.array(magicLinkRecordSchema),
  phoneChallenges: z.array(phoneChallengeRecordSchema).default([]),
  quota: z.array(quotaRecordSchema),
});

type PlatformState = z.infer<typeof platformStateSchema>;

const emptyState = (): PlatformState => ({
  version: 1,
  users: [],
  sessions: [],
  magicLinks: [],
  phoneChallenges: [],
  quota: [],
});

/**
 * Single-user local platform state. The same authoritative services used by a
 * hosted deployment run against this store; only the persistence differs.
 *
 * Local accounts are marked phone-verified so free-tier quota can be exercised
 * offline. Hosted sign-up (Phase 5) replaces this with OTP verification.
 */
export class FilePlatformStore implements AuthStore, PhoneStore, QuotaStore {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async read(): Promise<PlatformState> {
    const text = await readTextFile(this.filePath);
    if (text === undefined || text.trim().length === 0) {
      return emptyState();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new AppError({
        code: "validation_failed",
        message: "Platform state is corrupted. Remove it and sign in again.",
        cause: error,
      });
    }
    const result = platformStateSchema.safeParse(parsed);
    if (!result.success) {
      throw new AppError({
        code: "validation_failed",
        message: "Platform state is invalid. Remove it and sign in again.",
      });
    }
    return result.data;
  }

  private async mutate<Result>(
    operation: (state: PlatformState) => Result,
  ): Promise<Result> {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const result = operation(state);
      await writeFileAtomic(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | undefined> {
    const state = await this.read();
    return state.users.find((user) => user.email === email);
  }

  async findUserById(id: UserId): Promise<AuthUserRecord | undefined> {
    const state = await this.read();
    return state.users.find((user) => String(user.id) === String(id));
  }

  async createUser(email: string): Promise<AuthUserRecord> {
    return this.mutate((state) => {
      const user: AuthUserRecord = {
        id: userIdSchema.parse(newId()),
        email,
        plan: "free",
        phoneVerified: true,
        createdAt: nowIso(),
      };
      state.users.push(user);
      return user;
    });
  }

  async setPlan(userId: UserId, plan: AuthUserRecord["plan"]): Promise<void> {
    await this.mutate((state) => {
      const user = state.users.find((entry) => String(entry.id) === String(userId));
      if (user === undefined) {
        throw new AppError({ code: "not_found", message: "Account not found" });
      }
      state.users = state.users.map((entry) =>
        String(entry.id) === String(userId) ? { ...entry, plan } : entry,
      );
    });
  }

  async setPhoneVerified(userId: UserId, verified: boolean): Promise<void> {
    await this.mutate((state) => {
      const user = state.users.find((entry) => String(entry.id) === String(userId));
      if (user === undefined) {
        throw new AppError({ code: "not_found", message: "Account not found" });
      }
      state.users = state.users.map((entry) =>
        String(entry.id) === String(userId) ? { ...entry, phoneVerified: verified } : entry,
      );
    });
  }

  async getPhoneChallenge(phone: string): Promise<PhoneChallengeRecord | undefined> {
    const state = await this.read();
    return state.phoneChallenges.find((challenge) => challenge.phone === phone);
  }

  async savePhoneChallenge(record: PhoneChallengeRecord): Promise<void> {
    await this.mutate((state) => {
      state.phoneChallenges = state.phoneChallenges.filter(
        (challenge) => challenge.phone !== record.phone,
      );
      state.phoneChallenges.push(record);
    });
  }

  async deletePhoneChallenge(phone: string): Promise<void> {
    await this.mutate((state) => {
      state.phoneChallenges = state.phoneChallenges.filter(
        (challenge) => challenge.phone !== phone,
      );
    });
  }

  async saveSession(record: SessionRecord): Promise<void> {
    await this.mutate((state) => {
      state.sessions.push(record);
    });
  }

  async findSession(tokenHash: string): Promise<SessionRecord | undefined> {
    const state = await this.read();
    return state.sessions.find((session) => session.tokenHash === tokenHash);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.mutate((state) => {
      state.sessions = state.sessions.filter(
        (session) => session.tokenHash !== tokenHash,
      );
    });
  }

  async saveMagicLink(record: MagicLinkRecord): Promise<void> {
    await this.mutate((state) => {
      state.magicLinks.push(record);
    });
  }

  async consumeMagicLink(tokenHash: string): Promise<boolean> {
    return this.mutate((state) => {
      const before = state.magicLinks.length;
      state.magicLinks = state.magicLinks.filter(
        (link) => link.tokenHash !== tokenHash,
      );
      return state.magicLinks.length < before;
    });
  }

  async get(userId: UserId): Promise<QuotaUsageRecord | undefined> {
    const state = await this.read();
    return state.quota.find((record) => String(record.userId) === String(userId));
  }

  async put(record: QuotaUsageRecord): Promise<void> {
    await this.mutate((state) => {
      state.quota = state.quota.filter(
        (existing) => String(existing.userId) !== String(record.userId),
      );
      state.quota.push(record);
    });
  }
}
