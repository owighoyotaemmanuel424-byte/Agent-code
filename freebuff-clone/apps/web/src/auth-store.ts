import type { SqlDatabase } from "@freebuff/db";
import type {
  AuthStore,
  AuthUserRecord,
  MagicLinkRecord,
  PhoneChallengeRecord,
  PhoneStore,
  SessionRecord,
} from "@freebuff/auth";
import { planSchema, userIdSchema } from "@freebuff/shared";
import type { Plan, UserId } from "@freebuff/shared";

/**
 * Durable AuthStore for the web surface. Only token hashes are stored; a leaked
 * database cannot replay a session, magic link or verification code.
 */
export class SqliteAuthStore implements AuthStore, PhoneStore {
  private readonly db: SqlDatabase;

  constructor(options: { readonly db: SqlDatabase }) {
    this.db = options.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL,
        phone_verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS magic_links (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS phone_challenges (
        phone TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT NOT NULL
      );
    `);
  }

  private toUser(row: Record<string, unknown>): AuthUserRecord {
    return {
      id: userIdSchema.parse(String(row["id"])),
      email: String(row["email"]),
      plan: planSchema.parse(String(row["plan"])),
      phoneVerified: Number(row["phone_verified"] ?? 0) === 1,
      createdAt: String(row["created_at"]),
    };
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get([email]);
    return row === undefined ? undefined : this.toUser(row);
  }

  async findUserById(id: UserId): Promise<AuthUserRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get([String(id)]);
    return row === undefined ? undefined : this.toUser(row);
  }

  async createUser(email: string): Promise<AuthUserRecord> {
    const id = userIdSchema.parse(crypto.randomUUID());
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO users (id, email, plan, phone_verified, created_at) VALUES (?, ?, 'free', 0, ?)",
      )
      .run([String(id), email, createdAt]);
    return { id, email, plan: "free", phoneVerified: false, createdAt };
  }

  async setPlan(userId: UserId, plan: Plan): Promise<void> {
    const result = this.db
      .prepare("UPDATE users SET plan = ? WHERE id = ?")
      .run([planSchema.parse(plan), String(userId)]);
    if (result === 0) {
      throw new Error("Account not found");
    }
  }

  async setPhoneVerified(userId: UserId, verified: boolean): Promise<void> {
    const result = this.db
      .prepare("UPDATE users SET phone_verified = ? WHERE id = ?")
      .run([verified ? 1 : 0, String(userId)]);
    if (result === 0) {
      throw new Error("Account not found");
    }
  }

  async saveSession(record: SessionRecord): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run([
        record.tokenHash,
        String(record.userId),
        record.createdAt,
        record.expiresAt,
      ]);
  }

  async findSession(tokenHash: string): Promise<SessionRecord | undefined> {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get([tokenHash]);
    if (row === undefined) {
      return undefined;
    }
    return {
      tokenHash: String(row["token_hash"]),
      userId: userIdSchema.parse(String(row["user_id"])),
      createdAt: String(row["created_at"]),
      expiresAt: String(row["expires_at"]),
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run([tokenHash]);
  }

  async saveMagicLink(record: MagicLinkRecord): Promise<void> {
    this.db
      .prepare("INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, ?, ?)")
      .run([record.tokenHash, record.email, record.expiresAt]);
  }

  async consumeMagicLink(tokenHash: string): Promise<boolean> {
    return this.db.prepare("DELETE FROM magic_links WHERE token_hash = ?").run([tokenHash]) > 0;
  }

  async getPhoneChallenge(phone: string): Promise<PhoneChallengeRecord | undefined> {
    const row = this.db
      .prepare("SELECT * FROM phone_challenges WHERE phone = ?")
      .get([phone]);
    if (row === undefined) {
      return undefined;
    }
    return {
      phone: String(row["phone"]),
      userId: userIdSchema.parse(String(row["user_id"])),
      codeHash: String(row["code_hash"]),
      expiresAt: String(row["expires_at"]),
      attempts: Number(row["attempts"] ?? 0),
      sentAt: String(row["sent_at"]),
    };
  }

  async savePhoneChallenge(record: PhoneChallengeRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO phone_challenges (phone, user_id, code_hash, expires_at, attempts, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET
           user_id = excluded.user_id,
           code_hash = excluded.code_hash,
           expires_at = excluded.expires_at,
           attempts = excluded.attempts,
           sent_at = excluded.sent_at`,
      )
      .run([
        record.phone,
        String(record.userId),
        record.codeHash,
        record.expiresAt,
        record.attempts,
        record.sentAt,
      ]);
  }

  async deletePhoneChallenge(phone: string): Promise<void> {
    this.db.prepare("DELETE FROM phone_challenges WHERE phone = ?").run([phone]);
  }
}
