import { AppError, newId, userIdSchema } from "@freebuff/shared";
import type { Plan, UserId } from "@freebuff/shared";
import { hashToken, readTokenPayload, signToken } from "./crypto";

export interface AuthUserRecord {
  readonly id: UserId;
  readonly email: string;
  readonly plan: Plan;
  readonly phoneVerified: boolean;
  readonly createdAt: string;
}

export interface SessionRecord {
  readonly tokenHash: string;
  readonly userId: UserId;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface MagicLinkRecord {
  readonly tokenHash: string;
  readonly email: string;
  readonly expiresAt: string;
}

/** Persistence boundary for auth. Implementations live in the app/service. */
export interface AuthStore {
  findUserByEmail(email: string): Promise<AuthUserRecord | undefined>;
  findUserById(id: UserId): Promise<AuthUserRecord | undefined>;
  createUser(email: string): Promise<AuthUserRecord>;
  /** Plan changes are written by the billing service, never by a client. */
  setPlan(userId: UserId, plan: Plan): Promise<void>;
  setPhoneVerified(userId: UserId, verified: boolean): Promise<void>;
  saveSession(record: SessionRecord): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  saveMagicLink(record: MagicLinkRecord): Promise<void>;
  /** Atomically consumes a magic link; false when it is unknown or already used. */
  consumeMagicLink(tokenHash: string): Promise<boolean>;
}

export class InMemoryAuthStore implements AuthStore {
  readonly users = new Map<string, AuthUserRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly magicLinks = new Map<string, MagicLinkRecord>();

  async findUserByEmail(email: string): Promise<AuthUserRecord | undefined> {
    return [...this.users.values()].find((user) => user.email === email);
  }

  async findUserById(id: UserId): Promise<AuthUserRecord | undefined> {
    return this.users.get(String(id));
  }

  async createUser(email: string): Promise<AuthUserRecord> {
    const user: AuthUserRecord = {
      id: userIdSchema.parse(newId()),
      email,
      plan: "free",
      phoneVerified: false,
      createdAt: new Date().toISOString(),
    };
    this.users.set(String(user.id), user);
    return user;
  }

  async setPlan(userId: UserId, plan: Plan): Promise<void> {
    const user = this.users.get(String(userId));
    if (user === undefined) {
      throw new AppError({ code: "not_found", message: "Account not found" });
    }
    this.users.set(String(userId), { ...user, plan });
  }

  async setPhoneVerified(userId: UserId, verified: boolean): Promise<void> {
    const user = this.users.get(String(userId));
    if (user === undefined) {
      throw new AppError({ code: "not_found", message: "Account not found" });
    }
    this.users.set(String(userId), { ...user, phoneVerified: verified });
  }

  async saveSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.tokenHash, record);
  }

  async findSession(tokenHash: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(tokenHash);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async saveMagicLink(record: MagicLinkRecord): Promise<void> {
    this.magicLinks.set(record.tokenHash, record);
  }

  async consumeMagicLink(tokenHash: string): Promise<boolean> {
    return this.magicLinks.delete(tokenHash);
  }
}

export interface AuthServiceOptions {
  readonly store: AuthStore;
  readonly secret: string;
  readonly now?: () => Date;
  readonly magicLinkTtlMs?: number;
  readonly sessionTtlMs?: number;
}

export interface IssuedSession {
  readonly sessionToken: string;
  readonly user: AuthUserRecord;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface TokenPayload {
  readonly kind: string;
  readonly exp: number;
  readonly email?: string;
  readonly sub?: string;
}

const readPayload = (token: string, secret: string): TokenPayload | undefined => {
  const payload = readTokenPayload(token, secret);
  if (
    payload === undefined ||
    typeof payload["kind"] !== "string" ||
    typeof payload["exp"] !== "number"
  ) {
    return undefined;
  }
  return {
    kind: payload["kind"],
    exp: payload["exp"],
    ...(typeof payload["email"] === "string" ? { email: payload["email"] } : {}),
    ...(typeof payload["sub"] === "string" ? { sub: payload["sub"] } : {}),
  };
};

/**
 * Magic-link sign-in and session issuing. The service never sees a password and
 * stores only token hashes. Delivery of the link belongs to the calling surface
 * (email provider in production, console in local mode).
 */
export class AuthService {
  private readonly store: AuthStore;
  private readonly secret: string;
  private readonly now: () => Date;
  private readonly magicLinkTtlMs: number;
  private readonly sessionTtlMs: number;

  constructor(options: AuthServiceOptions) {
    if (options.secret.length < 32) {
      throw new AppError({
        code: "validation_failed",
        message: "Auth secret must be at least 32 characters",
      });
    }
    this.store = options.store;
    this.secret = options.secret;
    this.now = options.now ?? (() => new Date());
    this.magicLinkTtlMs = options.magicLinkTtlMs ?? 10 * 60 * 1000;
    this.sessionTtlMs = options.sessionTtlMs ?? 30 * DAY_MS;
  }

  async requestMagicLink(
    rawEmail: string,
  ): Promise<{ readonly token: string; readonly expiresAt: string }> {
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AppError({
        code: "validation_failed",
        message: "Enter a valid email address",
      });
    }
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.magicLinkTtlMs);
    const token = signToken(
      {
        kind: "magic",
        email,
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      this.secret,
    );
    await this.store.saveMagicLink({
      tokenHash: hashToken(token),
      email,
      expiresAt: expiresAt.toISOString(),
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async completeMagicLink(token: string): Promise<IssuedSession> {
    const payload = readPayload(token, this.secret);
    if (payload === undefined || payload.kind !== "magic" || payload.email === undefined) {
      throw new AppError({
        code: "unauthorized",
        message: "This sign-in link is not valid",
      });
    }
    if (payload.exp * 1000 <= this.now().getTime()) {
      throw new AppError({
        code: "unauthorized",
        message: "This sign-in link has expired",
      });
    }
    const consumed = await this.store.consumeMagicLink(hashToken(token));
    if (!consumed) {
      throw new AppError({
        code: "unauthorized",
        message: "This sign-in link has already been used",
      });
    }

    const existing = await this.store.findUserByEmail(payload.email);
    const user = existing ?? (await this.store.createUser(payload.email));
    return this.issueSession(user);
  }

  async issueSession(user: AuthUserRecord): Promise<IssuedSession> {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    const sessionToken = signToken(
      {
        kind: "session",
        sub: String(user.id),
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      this.secret,
    );
    await this.store.saveSession({
      tokenHash: hashToken(sessionToken),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    return { sessionToken, user };
  }

  async verifySession(token: string): Promise<AuthUserRecord> {
    const payload = readPayload(token, this.secret);
    if (payload === undefined || payload.kind !== "session" || payload.sub === undefined) {
      throw new AppError({ code: "unauthorized", message: "Not signed in" });
    }
    if (payload.exp * 1000 <= this.now().getTime()) {
      throw new AppError({
        code: "unauthorized",
        message: "Session expired, sign in again",
      });
    }
    const record = await this.store.findSession(hashToken(token));
    if (record === undefined) {
      throw new AppError({ code: "unauthorized", message: "Not signed in" });
    }
    if (Date.parse(record.expiresAt) <= this.now().getTime()) {
      await this.store.deleteSession(hashToken(token));
      throw new AppError({
        code: "unauthorized",
        message: "Session expired, sign in again",
      });
    }
    const user = await this.store.findUserById(record.userId);
    if (user === undefined) {
      throw new AppError({ code: "unauthorized", message: "Account not found" });
    }
    return user;
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteSession(hashToken(token));
  }
}
