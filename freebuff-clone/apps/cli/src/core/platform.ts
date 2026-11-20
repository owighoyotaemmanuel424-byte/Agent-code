import { randomBytes } from "node:crypto";
import { AuthService, PhoneVerificationService } from "@freebuff/auth";
import type {
  AuthUserRecord,
  IssuedSession,
  PhoneChallenge,
} from "@freebuff/auth";
import { defaultQuotaConfig, QuotaService } from "@freebuff/quota";
import type { QuotaConfig, QuotaEvaluation, QuotaSubject } from "@freebuff/quota";
import { userIdSchema } from "@freebuff/shared";
import { readTextFile, writeFileAtomic } from "./fs-utils";
import type { CliPaths } from "./paths";
import { FilePlatformStore } from "./store";

/**
 * Everything the CLI needs from the platform. In Phase 2 the authoritative
 * services run locally; a hosted implementation of this same interface arrives
 * with the cloud phase without any change to callers.
 */
export interface PlatformClient {
  requestMagicLink(email: string): Promise<{ readonly token: string; readonly expiresAt: string }>;
  completeMagicLink(token: string): Promise<IssuedSession>;
  verifySession(token: string): Promise<AuthUserRecord>;
  logout(token: string): Promise<void>;
  beginHour(subject: QuotaSubject): Promise<QuotaEvaluation>;
  quotaSnapshot(subject: QuotaSubject): Promise<QuotaEvaluation>;
  requestPhoneCode(input: {
    readonly userId: string;
    readonly phone: string;
  }): Promise<PhoneChallenge>;
  verifyPhoneCode(input: {
    readonly userId: string;
    readonly phone: string;
    readonly code: string;
  }): Promise<void>;
}

/** Persisted per-install signing secret, created with 256 bits of entropy. */
export const ensureAuthSecret = async (paths: CliPaths): Promise<string> => {
  const existing = (await readTextFile(paths.authSecretFile))?.trim();
  if (existing !== undefined && existing.length >= 32) {
    return existing;
  }
  const secret = randomBytes(48).toString("base64url");
  await writeFileAtomic(paths.authSecretFile, `${secret}\n`);
  return secret;
};

export interface LocalPlatformOptions {
  readonly quotaConfig?: QuotaConfig;
  readonly now?: () => Date;
}

export const createLocalPlatform = async (
  paths: CliPaths,
  options: LocalPlatformOptions = {},
): Promise<PlatformClient> => {
  const secret = await ensureAuthSecret(paths);
  const store = new FilePlatformStore(paths.stateFile);
  const auth = new AuthService({
    store,
    secret,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const quota = new QuotaService({
    store,
    config: options.quotaConfig ?? defaultQuotaConfig,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const phone = new PhoneVerificationService({
    store,
    authStore: store,
    secret,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return {
    requestMagicLink: (email) => auth.requestMagicLink(email),
    completeMagicLink: (token) => auth.completeMagicLink(token),
    verifySession: (token) => auth.verifySession(token),
    logout: (token) => auth.logout(token),
    beginHour: (subject) => quota.beginHour(subject),
    quotaSnapshot: (subject) => quota.snapshot(subject),
    requestPhoneCode: (input) =>
      phone.requestCode({
        userId: userIdSchema.parse(input.userId),
        phone: input.phone,
      }),
    verifyPhoneCode: (input) =>
      phone.verifyCode({
        userId: userIdSchema.parse(input.userId),
        phone: input.phone,
        code: input.code,
      }),
  };
};
