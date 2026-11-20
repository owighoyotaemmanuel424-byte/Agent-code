import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { AppError, userIdSchema } from "@freebuff/shared";
import type { UserId } from "@freebuff/shared";
import type { AuthStore } from "./service";

/** Persisted OTP challenge. Only the code hash is stored. */
export interface PhoneChallengeRecord {
  readonly phone: string;
  readonly userId: UserId;
  readonly codeHash: string;
  readonly expiresAt: string;
  readonly attempts: number;
  readonly sentAt: string;
}

export interface PhoneStore {
  getPhoneChallenge(phone: string): Promise<PhoneChallengeRecord | undefined>;
  savePhoneChallenge(record: PhoneChallengeRecord): Promise<void>;
  deletePhoneChallenge(phone: string): Promise<void>;
}

export class InMemoryPhoneStore implements PhoneStore {
  private readonly challenges = new Map<string, PhoneChallengeRecord>();

  async getPhoneChallenge(phone: string): Promise<PhoneChallengeRecord | undefined> {
    return this.challenges.get(phone);
  }

  async savePhoneChallenge(record: PhoneChallengeRecord): Promise<void> {
    this.challenges.set(record.phone, record);
  }

  async deletePhoneChallenge(phone: string): Promise<void> {
    this.challenges.delete(phone);
  }
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes a dialled number to E.164. Spaces, dashes, dots and parentheses are
 * cosmetic; a leading `+` and a country code are required so the platform never
 * has to guess a region.
 */
export const normalizePhone = (raw: string): string => {
  const compact = raw.trim().replace(/[\s().-]+/g, "");
  if (!E164.test(compact)) {
    throw new AppError({
      code: "validation_failed",
      message: "Enter a phone number in international format, for example +14155550123",
    });
  }
  return compact;
};

/** `+1••••••0123`: enough to recognise, not enough to reuse. */
export const maskPhone = (phone: string): string => {
  const visible = phone.slice(-4);
  return `${phone.slice(0, 2)}${"•".repeat(Math.max(phone.length - 6, 0))}${visible}`;
};

const hashCode = (secret: string, userId: UserId, phone: string, code: string): string =>
  createHmac("sha256", secret)
    .update(`${String(userId)}\n${phone}\n${code}`)
    .digest("hex");

const matches = (expectedHex: string, actualHex: string): boolean => {
  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(actualHex, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export interface PhoneChallenge {
  readonly phone: string;
  readonly maskedPhone: string;
  readonly expiresAt: string;
  readonly delivery: "dev" | "sms";
  /** Present only in dev delivery, where no SMS provider is configured. */
  readonly code?: string;
}

export interface PhoneVerificationOptions {
  readonly store: PhoneStore;
  readonly authStore: AuthStore;
  readonly secret: string;
  readonly now?: () => Date;
  readonly codeTtlMs?: number;
  readonly resendCooldownMs?: number;
  readonly maxAttempts?: number;
  /** When omitted the code is returned to the caller (`delivery: "dev"`). */
  readonly sendSms?: (phone: string, code: string) => Promise<void>;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

/**
 * Free-tier phone verification. Six-digit codes are bound to the account and
 * number, stored as HMACs, expire after five minutes, and allow a bounded number
 * of attempts. A successful verification flips the account flag that quota reads.
 */
export class PhoneVerificationService {
  private readonly store: PhoneStore;
  private readonly authStore: AuthStore;
  private readonly secret: string;
  private readonly now: () => Date;
  private readonly codeTtlMs: number;
  private readonly resendCooldownMs: number;
  private readonly maxAttempts: number;
  private readonly sendSms: ((phone: string, code: string) => Promise<void>) | undefined;

  constructor(options: PhoneVerificationOptions) {
    if (options.secret.length < 32) {
      throw new AppError({
        code: "validation_failed",
        message: "Phone verification secret must be at least 32 characters",
      });
    }
    this.store = options.store;
    this.authStore = options.authStore;
    this.secret = options.secret;
    this.now = options.now ?? (() => new Date());
    this.codeTtlMs = options.codeTtlMs ?? FIVE_MINUTES_MS;
    this.resendCooldownMs = options.resendCooldownMs ?? ONE_MINUTE_MS;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.sendSms = options.sendSms;
  }

  async requestCode(input: {
    readonly userId: UserId;
    readonly phone: string;
  }): Promise<PhoneChallenge> {
    const userId = userIdSchema.parse(String(input.userId));
    const phone = normalizePhone(input.phone);
    const now = this.now();
    const existing = await this.store.getPhoneChallenge(phone);
    if (existing !== undefined) {
      const sentAt = Date.parse(existing.sentAt);
      if (!Number.isNaN(sentAt) && now.getTime() - sentAt < this.resendCooldownMs) {
        throw new AppError({
          code: "conflict",
          message: "A code was just sent. Wait a minute before requesting another.",
        });
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(now.getTime() + this.codeTtlMs).toISOString();
    await this.store.savePhoneChallenge({
      phone,
      userId,
      codeHash: hashCode(this.secret, userId, phone, code),
      expiresAt,
      attempts: 0,
      sentAt: now.toISOString(),
    });
    await this.sendSms?.(phone, code);

    return {
      phone,
      maskedPhone: maskPhone(phone),
      expiresAt,
      delivery: this.sendSms === undefined ? "dev" : "sms",
      ...(this.sendSms === undefined ? { code } : {}),
    };
  }

  async verifyCode(input: {
    readonly userId: UserId;
    readonly phone: string;
    readonly code: string;
  }): Promise<void> {
    const userId = userIdSchema.parse(String(input.userId));
    const phone = normalizePhone(input.phone);
    const challenge = await this.store.getPhoneChallenge(phone);
    if (challenge === undefined) {
      throw new AppError({
        code: "unauthorized",
        message: "No verification code is pending for this number",
      });
    }
    if (String(challenge.userId) !== String(userId)) {
      throw new AppError({
        code: "unauthorized",
        message: "This verification code belongs to another account",
      });
    }
    if (Date.parse(challenge.expiresAt) <= this.now().getTime()) {
      await this.store.deletePhoneChallenge(phone);
      throw new AppError({
        code: "unauthorized",
        message: "This verification code has expired",
      });
    }
    if (challenge.attempts >= this.maxAttempts) {
      await this.store.deletePhoneChallenge(phone);
      throw new AppError({
        code: "unauthorized",
        message: "Too many attempts. Request a new code.",
      });
    }

    const expected = hashCode(this.secret, userId, phone, input.code.trim());
    if (!matches(expected, challenge.codeHash)) {
      await this.store.savePhoneChallenge({
        ...challenge,
        attempts: challenge.attempts + 1,
      });
      throw new AppError({
        code: "unauthorized",
        message: "That code is not correct",
      });
    }

    await this.store.deletePhoneChallenge(phone);
    await this.authStore.setPhoneVerified(userId, true);
  }
}
