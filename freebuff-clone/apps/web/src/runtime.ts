import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { applySchema, createTableRepository, openSqliteDatabase } from "@freebuff/db";
import type { SqlDatabase, TableDefinition, TableRepository } from "@freebuff/db";
import { AppError, newId } from "@freebuff/shared";
import type { AppFileRecord, AppRecord, PlatformStore } from "./store";
import { appSpecToSchema, findEntity } from "./spec";
import type { AppEntity, AppField } from "./spec";

const TEXT_LIMIT = 2_000;
const LONG_TEXT_LIMIT = 20_000;

export const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/octet-stream",
]);

interface AppDatabase {
  readonly db: SqlDatabase;
  readonly tables: ReadonlyMap<string, TableDefinition>;
  readonly repositories: Map<string, TableRepository>;
}

export interface AppRuntimeOptions {
  readonly root: string;
  readonly store: PlatformStore;
  readonly now?: () => Date;
  readonly maxFileBytes?: number;
  readonly maxAppBytes?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const coerceField = (field: AppField, value: unknown): unknown => {
  if (value === null || value === undefined || value === "") {
    if (field.required) {
      throw new AppError({
        code: "validation_failed",
        message: `"${field.label}" is required`,
      });
    }
    return null;
  }
  switch (field.type) {
    case "text":
    case "longtext": {
      if (typeof value !== "string") {
        throw new AppError({
          code: "validation_failed",
          message: `"${field.label}" must be text`,
        });
      }
      const limit = field.type === "text" ? TEXT_LIMIT : LONG_TEXT_LIMIT;
      if (value.length > limit) {
        throw new AppError({
          code: "validation_failed",
          message: `"${field.label}" is longer than ${String(limit)} characters`,
        });
      }
      return value;
    }
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new AppError({
          code: "validation_failed",
          message: `"${field.label}" must be a whole number`,
        });
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new AppError({
          code: "validation_failed",
          message: `"${field.label}" must be true or false`,
        });
      }
      return value;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new AppError({
          code: "validation_failed",
          message: `"${field.label}" must be a YYYY-MM-DD date`,
        });
      }
      return value;
  }
};

const validateRow = (entity: AppEntity, body: unknown): Record<string, unknown> => {
  if (!isRecord(body)) {
    throw new AppError({
      code: "validation_failed",
      message: "Expected a JSON object",
    });
  }
  const fields = new Map(entity.fields.map((field) => [field.name, field]));
  for (const key of Object.keys(body)) {
    if (!fields.has(key)) {
      throw new AppError({
        code: "validation_failed",
        message: `Unknown field "${key}"`,
      });
    }
  }
  const out: Record<string, unknown> = {};
  for (const field of entity.fields) {
    out[field.name] = coerceField(field, body[field.name]);
  }
  return out;
};

const sanitizeFileName = (name: string): string => {
  const trimmed = basename(name.trim());
  if (trimmed.length === 0 || trimmed.length > 120 || /[\u0000-\u001f]/.test(trimmed)) {
    throw new AppError({
      code: "validation_failed",
      message: "Choose a file with a normal name",
    });
  }
  return trimmed;
};

const decodeBase64 = (value: string): Buffer => {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new AppError({
      code: "validation_failed",
      message: "File content must be base64 encoded",
    });
  }
  return Buffer.from(value, "base64");
};

/**
 * Owns each generated app's SQLite database, row ownership and uploaded files.
 * Tables come from the validated spec, and every row query is scoped to the
 * signed-in user's id.
 */
export class AppRuntime {
  private readonly root: string;
  private readonly store: PlatformStore;
  private readonly now: () => Date;
  private readonly maxFileBytes: number;
  private readonly maxAppBytes: number;
  private readonly databases = new Map<string, AppDatabase>();

  constructor(options: AppRuntimeOptions) {
    this.root = options.root;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
    this.maxAppBytes = options.maxAppBytes ?? 20 * 1024 * 1024;
  }

  private async databaseFor(app: AppRecord): Promise<AppDatabase> {
    const cached = this.databases.get(app.id);
    if (cached !== undefined) {
      return cached;
    }
    const schema = appSpecToSchema(app.spec);
    const directory = join(this.root, "apps", app.id);
    await mkdir(directory, { recursive: true });
    const db = openSqliteDatabase(join(directory, "data.sqlite"));
    applySchema(db, schema, { now: this.now });
    const database: AppDatabase = {
      db,
      tables: new Map(schema.tables.map((table) => [table.name, table])),
      repositories: new Map(),
    };
    this.databases.set(app.id, database);
    return database;
  }

  private async repositoryFor(
    app: AppRecord,
    entityName: string,
  ): Promise<{ entity: AppEntity; repository: TableRepository }> {
    const entity = findEntity(app.spec, entityName);
    if (entity === undefined) {
      throw new AppError({
        code: "not_found",
        message: `Unknown collection "${entityName}"`,
      });
    }
    const database = await this.databaseFor(app);
    const table = database.tables.get(entity.name);
    if (table === undefined) {
      throw new AppError({
        code: "internal",
        message: `Table "${entity.name}" was not created`,
      });
    }
    let repository = database.repositories.get(entity.name);
    if (repository === undefined) {
      repository = createTableRepository(database.db, table, { now: this.now });
      database.repositories.set(entity.name, repository);
    }
    return { entity, repository };
  }

  async listRows(
    app: AppRecord,
    entityName: string,
    ownerId: string,
    limit = 50,
  ): Promise<Record<string, unknown>[]> {
    const { repository } = await this.repositoryFor(app, entityName);
    return repository.list({
      where: { owner_id: ownerId },
      orderBy: "created_at",
      direction: "desc",
      limit,
    });
  }

  async createRow(
    app: AppRecord,
    entityName: string,
    ownerId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const { entity, repository } = await this.repositoryFor(app, entityName);
    const values = validateRow(entity, body);
    return repository.insert({
      ...values,
      owner_id: ownerId,
      created_at: this.now().toISOString(),
    });
  }

  async deleteRow(
    app: AppRecord,
    entityName: string,
    ownerId: string,
    rowId: string,
  ): Promise<boolean> {
    const { repository } = await this.repositoryFor(app, entityName);
    const row = repository.findById(rowId);
    if (row === undefined) {
      throw new AppError({ code: "not_found", message: "Record not found" });
    }
    if (row["owner_id"] !== ownerId) {
      throw new AppError({
        code: "forbidden",
        message: "That record belongs to another user",
      });
    }
    return repository.delete(rowId);
  }

  async saveFile(
    app: AppRecord,
    ownerId: string,
    body: unknown,
  ): Promise<AppFileRecord> {
    if (!isRecord(body)) {
      throw new AppError({
        code: "validation_failed",
        message: "Expected a JSON object",
      });
    }
    const name = sanitizeFileName(typeof body["name"] === "string" ? body["name"] : "");
    const contentType =
      typeof body["contentType"] === "string" ? body["contentType"] : "";
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new AppError({
        code: "validation_failed",
        message: `Files of type "${contentType || "unknown"}" are not allowed`,
      });
    }
    const base64 = typeof body["contentBase64"] === "string" ? body["contentBase64"] : "";
    const bytes = decodeBase64(base64);
    if (bytes.length > this.maxFileBytes) {
      throw new AppError({
        code: "validation_failed",
        message: `Files are limited to ${String(Math.floor(this.maxFileBytes / 1024 / 1024))} MB`,
      });
    }
    if (this.store.totalFileBytes(app.id) + bytes.length > this.maxAppBytes) {
      throw new AppError({
        code: "quota_exceeded",
        message: "This app is out of file storage",
      });
    }

    const fileId = newId();
    const directory = join(this.root, "apps", app.id, "files");
    await mkdir(directory, { recursive: true });
    const storagePath = join(directory, fileId);
    await writeFile(storagePath, bytes);
    return this.store.addFile({
      id: fileId,
      appId: app.id,
      ownerId,
      name,
      contentType,
      size: bytes.length,
      storagePath,
      createdAt: this.now().toISOString(),
    });
  }

  async readFile(
    app: AppRecord,
    ownerId: string,
    fileId: string,
  ): Promise<{ file: AppFileRecord; bytes: Buffer }> {
    const file = this.store.findFile(app.id, fileId);
    if (file === undefined) {
      throw new AppError({ code: "not_found", message: "File not found" });
    }
    if (file.ownerId !== ownerId) {
      throw new AppError({
        code: "forbidden",
        message: "That file belongs to another user",
      });
    }
    return { file, bytes: await readFile(file.storagePath) };
  }
}
