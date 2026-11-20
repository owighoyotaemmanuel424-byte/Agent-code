import type { SqlDatabase } from "@freebuff/db";
import { appSpecSchema } from "./spec";
import type { AppSpec } from "./spec";

export type AppStatus = "building" | "deployed" | "failed";

export interface AppRecord {
  readonly id: string;
  readonly slug: string;
  readonly prompt: string;
  readonly spec: AppSpec;
  readonly status: AppStatus;
  readonly createdAt: string;
  readonly deployedAt?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Set for apps built by a signed-in account; absent for legacy rows. */
  readonly ownerId?: string;
}

export interface AppFileRecord {
  readonly id: string;
  readonly appId: string;
  readonly ownerId: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly storagePath: string;
  readonly createdAt: string;
}

const toApp = (row: Record<string, unknown>): AppRecord => ({
  id: String(row["id"]),
  slug: String(row["slug"]),
  prompt: String(row["prompt"]),
  spec: appSpecSchema.parse(JSON.parse(String(row["spec_json"]))),
  status: String(row["status"]) as AppStatus,
  createdAt: String(row["created_at"]),
  ...(row["deployed_at"] === null || row["deployed_at"] === undefined
    ? {}
    : { deployedAt: String(row["deployed_at"]) }),
  inputTokens: Number(row["input_tokens"] ?? 0),
  outputTokens: Number(row["output_tokens"] ?? 0),
  ...(row["owner_id"] === null || row["owner_id"] === undefined
    ? {}
    : { ownerId: String(row["owner_id"]) }),
});

const toFile = (row: Record<string, unknown>): AppFileRecord => ({
  id: String(row["id"]),
  appId: String(row["app_id"]),
  ownerId: String(row["owner_id"]),
  name: String(row["name"]),
  contentType: String(row["content_type"]),
  size: Number(row["size"]),
  storagePath: String(row["storage_path"]),
  createdAt: String(row["created_at"]),
});

export class PlatformStore {
  private readonly db: SqlDatabase;

  constructor(options: { readonly db: SqlDatabase }) {
    this.db = options.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        prompt TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        status TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        deployed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS app_files (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_files_app ON app_files(app_id, owner_id);
    `);
    const columns = this.db
      .prepare("PRAGMA table_info(apps)")
      .all([])
      .map((row) => String(row["name"]));
    if (!columns.includes("owner_id")) {
      this.db.exec("ALTER TABLE apps ADD COLUMN owner_id TEXT");
    }
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS apps_owner ON apps(owner_id, created_at)",
    );
  }

  createApp(input: {
    readonly id: string;
    readonly slug: string;
    readonly prompt: string;
    readonly spec: AppSpec;
    readonly createdAt: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly ownerId?: string;
  }): AppRecord {
    this.db
      .prepare(
        `INSERT INTO apps (id, slug, prompt, spec_json, status, input_tokens, output_tokens, created_at, owner_id)
         VALUES (?, ?, ?, ?, 'building', ?, ?, ?, ?)`,
      )
      .run([
        input.id,
        input.slug,
        input.prompt,
        JSON.stringify(input.spec),
        input.inputTokens,
        input.outputTokens,
        input.createdAt,
        input.ownerId ?? null,
      ]);
    const created = this.findApp(input.id);
    if (created === undefined) {
      throw new Error("App insert did not persist");
    }
    return created;
  }

  findApp(id: string): AppRecord | undefined {
    const row = this.db.prepare("SELECT * FROM apps WHERE id = ?").get([id]);
    return row === undefined ? undefined : toApp(row);
  }

  findAppBySlug(slug: string): AppRecord | undefined {
    const row = this.db.prepare("SELECT * FROM apps WHERE slug = ?").get([slug]);
    return row === undefined ? undefined : toApp(row);
  }

  listApps(limit = 50, ownerId?: string): AppRecord[] {
    const bounded = Math.min(Math.max(limit, 1), 100);
    const rows =
      ownerId === undefined
        ? this.db
            .prepare("SELECT * FROM apps ORDER BY created_at DESC LIMIT ?")
            .all([bounded])
        : this.db
            .prepare(
              "SELECT * FROM apps WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
            )
            .all([ownerId, bounded]);
    return rows.map(toApp);
  }

  markDeployed(id: string, deployedAt: string): void {
    this.db
      .prepare("UPDATE apps SET status = 'deployed', deployed_at = ? WHERE id = ?")
      .run([deployedAt, id]);
  }

  markFailed(id: string): void {
    this.db.prepare("UPDATE apps SET status = 'failed' WHERE id = ?").run([id]);
  }

  addFile(input: {
    readonly id: string;
    readonly appId: string;
    readonly ownerId: string;
    readonly name: string;
    readonly contentType: string;
    readonly size: number;
    readonly storagePath: string;
    readonly createdAt: string;
  }): AppFileRecord {
    this.db
      .prepare(
        `INSERT INTO app_files (id, app_id, owner_id, name, content_type, size, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run([
        input.id,
        input.appId,
        input.ownerId,
        input.name,
        input.contentType,
        input.size,
        input.storagePath,
        input.createdAt,
      ]);
    return {
      id: input.id,
      appId: input.appId,
      ownerId: input.ownerId,
      name: input.name,
      contentType: input.contentType,
      size: input.size,
      storagePath: input.storagePath,
      createdAt: input.createdAt,
    };
  }

  listFiles(appId: string, ownerId: string): AppFileRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM app_files WHERE app_id = ? AND owner_id = ? ORDER BY created_at DESC",
      )
      .all([appId, ownerId])
      .map(toFile);
  }

  findFile(appId: string, fileId: string): AppFileRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM app_files WHERE app_id = ? AND id = ?")
      .get([appId, fileId]);
    return row === undefined ? undefined : toFile(row);
  }

  totalFileBytes(appId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(size), 0) AS total FROM app_files WHERE app_id = ?")
      .get([appId]);
    return Number(row?.["total"] ?? 0);
  }
}
