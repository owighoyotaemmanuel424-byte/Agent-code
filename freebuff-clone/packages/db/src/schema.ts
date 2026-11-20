import { AppError } from "@freebuff/shared";
import { z } from "zod";

/**
 * Schema DSL for generated apps. Identifiers are validated at definition time
 * because they are interpolated into DDL; values never are.
 */
export const identifierSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9_]*$/, "must be lower_snake_case");

export const columnTypeSchema = z.enum([
  "text",
  "longtext",
  "integer",
  "real",
  "boolean",
  "timestamp",
  "json",
]);
export type ColumnType = z.infer<typeof columnTypeSchema>;

export type ColumnDefault = string | number | boolean | null;

export interface ColumnDefinition {
  readonly name: string;
  readonly type: ColumnType;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly defaultValue?: ColumnDefault;
}

export interface TableDefinition {
  readonly name: string;
  readonly columns: readonly ColumnDefinition[];
}

export interface SchemaDefinition {
  readonly tables: readonly TableDefinition[];
}

const SQL_TYPE: Record<ColumnType, string> = {
  text: "TEXT",
  longtext: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "INTEGER",
  timestamp: "TEXT",
  json: "TEXT",
};

const assertIdentifier = (value: string, label: string): string => {
  const parsed = identifierSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: "validation_failed",
      message: `${label} "${value}" is not a valid lower_snake_case identifier`,
    });
  }
  return parsed.data;
};

/** Fluent column builder. Instances are immutable after schema definition. */
export class ColumnBuilder {
  readonly type: ColumnType;
  private required = false;
  private key = false;
  private uniqueValue = false;
  private fallback: ColumnDefault | undefined;

  constructor(type: ColumnType) {
    this.type = type;
  }

  notNull(): this {
    this.required = true;
    return this;
  }

  primaryKey(): this {
    this.key = true;
    this.required = true;
    return this;
  }

  unique(): this {
    this.uniqueValue = true;
    return this;
  }

  default(value: ColumnDefault): this {
    this.fallback = value;
    return this;
  }

  toDefinition(name: string): ColumnDefinition {
    return {
      name,
      type: this.type,
      notNull: this.required,
      primaryKey: this.key,
      unique: this.uniqueValue,
      ...(this.fallback === undefined ? {} : { defaultValue: this.fallback }),
    };
  }
}

export const text = (): ColumnBuilder => new ColumnBuilder("text");
export const longText = (): ColumnBuilder => new ColumnBuilder("longtext");
export const integer = (): ColumnBuilder => new ColumnBuilder("integer");
export const real = (): ColumnBuilder => new ColumnBuilder("real");
export const boolean = (): ColumnBuilder => new ColumnBuilder("boolean");
export const timestamp = (): ColumnBuilder => new ColumnBuilder("timestamp");
export const jsonColumn = (): ColumnBuilder => new ColumnBuilder("json");

const DEFAULT_ID: ColumnDefinition = {
  name: "id",
  type: "text",
  notNull: true,
  primaryKey: true,
  unique: false,
};

export const defineTable = (
  name: string,
  columns: Readonly<Record<string, ColumnBuilder>>,
): TableDefinition => {
  assertIdentifier(name, "Table name");
  const defined = Object.entries(columns).map(([columnName, builder]) => {
    assertIdentifier(columnName, "Column name");
    return builder.toDefinition(columnName);
  });
  const primaryKeys = defined.filter((column) => column.primaryKey);
  if (primaryKeys.length > 1) {
    throw new AppError({
      code: "validation_failed",
      message: `Table "${name}" declares more than one primary key`,
    });
  }
  const withKey = defined.some((column) => column.primaryKey)
    ? defined
    : [DEFAULT_ID, ...defined];
  return { name, columns: withKey };
};

export const defineSchema = (
  tables: readonly TableDefinition[],
): SchemaDefinition => {
  if (tables.length === 0) {
    throw new AppError({
      code: "validation_failed",
      message: "A schema needs at least one table",
    });
  }
  const names = new Set<string>();
  for (const table of tables) {
    if (names.has(table.name)) {
      throw new AppError({
        code: "validation_failed",
        message: `Duplicate table "${table.name}"`,
      });
    }
    names.add(table.name);
  }
  return { tables };
};

export const quoteIdentifier = (name: string): string =>
  `"${assertIdentifier(name, "Identifier")}"`;

const renderDefault = (value: ColumnDefault): string => {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AppError({
        code: "validation_failed",
        message: "Column defaults must be finite numbers",
      });
    }
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
};

const columnSql = (column: ColumnDefinition, includeKey: boolean): string => {
  const parts = [quoteIdentifier(column.name), SQL_TYPE[column.type]];
  if (column.notNull) {
    parts.push("NOT NULL");
  }
  if (includeKey && column.primaryKey) {
    parts.push("PRIMARY KEY");
  }
  if (column.unique && !column.primaryKey) {
    parts.push("UNIQUE");
  }
  if (column.defaultValue !== undefined) {
    parts.push(`DEFAULT ${renderDefault(column.defaultValue)}`);
  }
  return parts.join(" ");
};

export const createTableSql = (table: TableDefinition): string =>
  `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (${table.columns
    .map((column) => columnSql(column, true))
    .join(", ")})`;

/** SQL used for the ejectable `schema.sql` artifact. */
export const schemaToSql = (schema: SchemaDefinition): string =>
  `${schema.tables.map((table) => `${createTableSql(table)};`).join("\n")}\n`;
