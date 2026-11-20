import { AppError } from "@freebuff/shared";
import { createTableSql, quoteIdentifier } from "./schema";
import type { ColumnDefinition, SchemaDefinition } from "./schema";
import type { SqlDatabase } from "./sqlite";

export interface MigrationResult {
  /** Migration ids applied by this call. Empty when already up to date. */
  readonly applied: readonly string[];
}

const MIGRATIONS_TABLE = "_freebuff_migrations";

interface ExistingColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
}

const tableExists = (db: SqlDatabase, table: string): boolean => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get([table]);
  return row !== undefined;
};

const existingColumns = (db: SqlDatabase, table: string): ExistingColumn[] =>
  db
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all([])
    .map((row) => ({
      name: String(row["name"]),
      type: String(row["type"] ?? "").toUpperCase(),
      notNull: Number(row["notnull"] ?? 0) === 1,
      primaryKey: Number(row["pk"] ?? 0) > 0,
    }));

const SQL_TYPE: Record<ColumnDefinition["type"], string> = {
  text: "TEXT",
  longtext: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "INTEGER",
  timestamp: "TEXT",
  json: "TEXT",
};

const recordMigration = (
  db: SqlDatabase,
  version: string,
  appliedAt: string,
): boolean =>
  db
    .prepare(
      `INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (version, applied_at) VALUES (?, ?)`,
    )
    .run([version, appliedAt]) > 0;

const addColumnSql = (table: string, column: ColumnDefinition): string => {
  const parts = [
    `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN`,
    quoteIdentifier(column.name),
    SQL_TYPE[column.type],
  ];
  if (column.notNull) {
    parts.push("NOT NULL");
  }
  if (column.defaultValue !== undefined) {
    const value = column.defaultValue;
    const rendered =
      value === null
        ? "NULL"
        : typeof value === "boolean"
          ? value
            ? "1"
            : "0"
          : typeof value === "number"
            ? String(value)
            : `'${value.replace(/'/g, "''")}'`;
    parts.push(`DEFAULT ${rendered}`);
  }
  return parts.join(" ");
};

/**
 * Applies a schema as forward-only migrations: create missing tables, add
 * missing columns, and refuse destructive or ambiguous changes. Safe to call on
 * every boot; already-applied steps are tracked in `_freebuff_migrations`.
 */
export const applySchema = (
  db: SqlDatabase,
  schema: SchemaDefinition,
  options: { readonly now?: () => Date } = {},
): MigrationResult => {
  const now = options.now ?? (() => new Date());
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  const applied: string[] = [];
  const appliedAt = now().toISOString();

  for (const table of schema.tables) {
    if (!tableExists(db, table.name)) {
      db.exec(createTableSql(table));
      const version = `create:${table.name}`;
      if (recordMigration(db, version, appliedAt)) {
        applied.push(version);
      }
      continue;
    }

    const existing = existingColumns(db, table.name);
    const byName = new Map(existing.map((column) => [column.name, column]));
    for (const column of table.columns) {
      const current = byName.get(column.name);
      if (current === undefined) {
        if (column.primaryKey) {
          throw new AppError({
            code: "conflict",
            message: `Cannot add primary key "${column.name}" to existing table "${table.name}"`,
          });
        }
        if (column.notNull && column.defaultValue === undefined) {
          throw new AppError({
            code: "conflict",
            message: `Cannot add required column "${table.name}.${column.name}" without a default`,
          });
        }
        db.exec(addColumnSql(table.name, column));
        const version = `alter:${table.name}.${column.name}`;
        if (recordMigration(db, version, appliedAt)) {
          applied.push(version);
        }
        continue;
      }
      if (current.type !== SQL_TYPE[column.type]) {
        throw new AppError({
          code: "conflict",
          message: `Column "${table.name}.${column.name}" changes type from ${current.type} to ${SQL_TYPE[column.type]}; migrations are additive only`,
        });
      }
    }
  }

  return { applied };
};
