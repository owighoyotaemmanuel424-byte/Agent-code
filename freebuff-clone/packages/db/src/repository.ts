import { AppError, newId } from "@freebuff/shared";
import { quoteIdentifier } from "./schema";
import type { ColumnDefinition, TableDefinition } from "./schema";
import type { SqlDatabase, SqlValue } from "./sqlite";

export interface ListOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: string;
  readonly direction?: "asc" | "desc";
  /** Equality filters; keys are validated against the table definition. */
  readonly where?: Readonly<Record<string, SqlValue>>;
}

const MAX_LIMIT = 200;

const encodeValue = (column: ColumnDefinition, value: unknown): SqlValue => {
  if (value === null || value === undefined) {
    if (column.notNull) {
      throw new AppError({
        code: "validation_failed",
        message: `"${column.name}" is required`,
      });
    }
    return null;
  }
  switch (column.type) {
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new AppError({
          code: "validation_failed",
          message: `"${column.name}" must be an integer`,
        });
      }
      return value;
    case "real":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new AppError({
          code: "validation_failed",
          message: `"${column.name}" must be a number`,
        });
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new AppError({
          code: "validation_failed",
          message: `"${column.name}" must be a boolean`,
        });
      }
      return value ? 1 : 0;
    case "json":
      return JSON.stringify(value);
    case "text":
    case "longtext":
    case "timestamp":
      if (typeof value !== "string") {
        throw new AppError({
          code: "validation_failed",
          message: `"${column.name}" must be text`,
        });
      }
      return value;
  }
};

const decodeValue = (column: ColumnDefinition, value: unknown): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (column.type === "boolean") {
    return Number(value) === 1;
  }
  if (column.type === "json" && typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value;
};

const decodeRow = (
  table: TableDefinition,
  row: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const column of table.columns) {
    out[column.name] = decodeValue(column, row[column.name]);
  }
  return out;
};

export interface TableRepository {
  insert(values: Readonly<Record<string, unknown>>): Record<string, unknown>;
  update(
    id: string,
    values: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> | undefined;
  delete(id: string): boolean;
  findById(id: string): Record<string, unknown> | undefined;
  list(options?: ListOptions): Record<string, unknown>[];
  count(where?: Readonly<Record<string, SqlValue>>): number;
}

/**
 * Typed CRUD for one table. Every statement is parameterised; column names are
 * validated identifiers from the table definition, never user input.
 */
export const createTableRepository = (
  db: SqlDatabase,
  table: TableDefinition,
  options: { readonly now?: () => Date } = {},
): TableRepository => {
  const now = options.now ?? (() => new Date());
  const columns = new Map(table.columns.map((column) => [column.name, column]));
  const tableSql = quoteIdentifier(table.name);
  const hasCreatedAt = columns.has("createdAt");

  const assertKnownKeys = (values: Readonly<Record<string, unknown>>): void => {
    for (const key of Object.keys(values)) {
      if (!columns.has(key)) {
        throw new AppError({
          code: "validation_failed",
          message: `Unknown field "${key}" for table "${table.name}"`,
        });
      }
    }
  };

  const encodeRecord = (
    values: Readonly<Record<string, unknown>>,
    forUpdate: boolean,
  ): Map<string, SqlValue> => {
    assertKnownKeys(values);
    const encoded = new Map<string, SqlValue>();
    for (const [key, raw] of Object.entries(values)) {
      if (forUpdate && key === "id") {
        throw new AppError({
          code: "validation_failed",
          message: "The id of an existing row cannot be changed",
        });
      }
      const column = columns.get(key);
      if (column === undefined) {
        continue;
      }
      encoded.set(key, encodeValue(column, raw));
    }
    return encoded;
  };

  return {
    insert: (values) => {
      const encoded = encodeRecord(values, false);
      if (!encoded.has("id")) {
        encoded.set("id", newId());
      }
      if (hasCreatedAt && !encoded.has("createdAt")) {
        encoded.set("createdAt", now().toISOString());
      }
      const names = [...encoded.keys()];
      const sql = `INSERT INTO ${tableSql} (${names
        .map(quoteIdentifier)
        .join(", ")}) VALUES (${names.map(() => "?").join(", ")})`;
      db.prepare(sql).run([...encoded.values()]);
      const id = encoded.get("id");
      const row = db
        .prepare(`SELECT * FROM ${tableSql} WHERE "id" = ?`)
        .get([id === undefined ? "" : id]);
      if (row === undefined) {
        throw new AppError({
          code: "internal",
          message: `Insert into "${table.name}" did not return a row`,
        });
      }
      return decodeRow(table, row);
    },

    update: (id, values) => {
      const encoded = encodeRecord(values, true);
      if (encoded.size === 0) {
        return undefined;
      }
      const assignments = [...encoded.keys()]
        .map((name) => `${quoteIdentifier(name)} = ?`)
        .join(", ");
      const changed = db
        .prepare(`UPDATE ${tableSql} SET ${assignments} WHERE "id" = ?`)
        .run([...encoded.values(), id]);
      if (changed === 0) {
        return undefined;
      }
      const row = db
        .prepare(`SELECT * FROM ${tableSql} WHERE "id" = ?`)
        .get([id]);
      return row === undefined ? undefined : decodeRow(table, row);
    },

    delete: (id) =>
      db.prepare(`DELETE FROM ${tableSql} WHERE "id" = ?`).run([id]) > 0,

    findById: (id) => {
      const row = db
        .prepare(`SELECT * FROM ${tableSql} WHERE "id" = ?`)
        .get([id]);
      return row === undefined ? undefined : decodeRow(table, row);
    },

    list: (listOptions) => {
      const limit = Math.min(Math.max(listOptions?.limit ?? 50, 1), MAX_LIMIT);
      const offset = Math.max(listOptions?.offset ?? 0, 0);
      const orderBy = listOptions?.orderBy ?? "id";
      if (!columns.has(orderBy)) {
        throw new AppError({
          code: "validation_failed",
          message: `Cannot order by unknown column "${orderBy}"`,
        });
      }
      const direction = listOptions?.direction === "desc" ? "DESC" : "ASC";
      const filters = Object.entries(listOptions?.where ?? {});
      const whereSql =
        filters.length === 0
          ? ""
          : ` WHERE ${filters
              .map(([name]) => {
                if (!columns.has(name)) {
                  throw new AppError({
                    code: "validation_failed",
                    message: `Unknown filter column "${name}"`,
                  });
                }
                return `${quoteIdentifier(name)} = ?`;
              })
              .join(" AND ")}`;
      return db
        .prepare(
          `SELECT * FROM ${tableSql}${whereSql} ORDER BY ${quoteIdentifier(orderBy)} ${direction} LIMIT ? OFFSET ?`,
        )
        .all([...filters.map(([, value]) => value), limit, offset])
        .map((row) => decodeRow(table, row));
    },

    count: (countOptions) => {
      const filters = Object.entries(countOptions ?? {});
      if (filters.length === 0) {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableSql}`).get([]);
        return Number(row?.["count"] ?? 0);
      }
      const whereSql = ` WHERE ${filters
        .map(([name]) => {
          if (!columns.has(name)) {
            throw new AppError({
              code: "validation_failed",
              message: `Unknown filter column "${name}"`,
            });
          }
          return `${quoteIdentifier(name)} = ?`;
        })
        .join(" AND ")}`;
      const row = db
        .prepare(`SELECT COUNT(*) AS count FROM ${tableSql}${whereSql}`)
        .get(filters.map(([, value]) => value));
      return Number(row?.["count"] ?? 0);
    },
  };
};

