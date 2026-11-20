import { createRequire } from "node:module";

interface StatementLike {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  close(): void;
}

interface SqliteModule {
  readonly DatabaseSync: new (path: string) => DatabaseLike;
}

// Loaded through require so bundlers that do not know `node:sqlite` still work.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as SqliteModule;

/**
 * Database values cross the boundary as primitives only. Every value is bound
 * as a statement parameter; SQL text never interpolates a value.
 */
export type SqlValue = string | number | null | Uint8Array;

export interface SqlStatement {
  /** Returns the number of affected rows. */
  run(values: readonly SqlValue[]): number;
  get(values: readonly SqlValue[]): Record<string, unknown> | undefined;
  all(values: readonly SqlValue[]): Record<string, unknown>[];
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

const asRow = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Opens a SQLite database with foreign keys, a busy timeout and WAL for
 * on-disk files. Node 22+ and Bun both implement `node:sqlite`, so tests and
 * the server share one driver.
 */
export const openSqliteDatabase = (path: string): SqlDatabase => {
  const database: DatabaseLike = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
  }
  return {
    exec: (sql: string): void => {
      database.exec(sql);
    },
    prepare: (sql: string): SqlStatement => {
      const statement = database.prepare(sql);
      return {
        run: (values: readonly SqlValue[]): number => {
          const result = statement.run(...values);
          return Number(result.changes);
        },
        get: (values: readonly SqlValue[]): Record<string, unknown> | undefined =>
          asRow(statement.get(...values)),
        all: (values: readonly SqlValue[]): Record<string, unknown>[] =>
          statement
            .all(...values)
            .map(asRow)
            .filter((row): row is Record<string, unknown> => row !== undefined),
      };
    },
    close: (): void => {
      database.close();
    },
  };
};
