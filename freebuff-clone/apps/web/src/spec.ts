import {
  boolean,
  defineSchema,
  defineTable,
  identifierSchema,
  integer,
  longText,
  text,
} from "@freebuff/db";
import type { ColumnBuilder, SchemaDefinition } from "@freebuff/db";
import { z } from "zod";

/**
 * A generated app is described by a validated spec before any file exists.
 * The model produces this spec; everything after it is deterministic and
 * auditable. User-supplied content never reaches SQL or HTML unescaped.
 */
export const appFieldTypeSchema = z.enum([
  "text",
  "longtext",
  "integer",
  "boolean",
  "date",
]);
export type AppFieldType = z.infer<typeof appFieldTypeSchema>;

export const appFieldSchema = z.object({
  name: identifierSchema,
  label: z.string().min(1).max(60),
  type: appFieldTypeSchema,
  required: z.boolean(),
});
export type AppField = z.infer<typeof appFieldSchema>;

const RESERVED_COLUMNS = new Set(["id", "owner_id", "created_at"]);

export const appEntitySchema = z
  .object({
    name: identifierSchema,
    label: z.string().min(1).max(60),
    fields: z.array(appFieldSchema).min(1).max(10),
  })
  .superRefine((entity, ctx) => {
    const seen = new Set<string>();
    for (const field of entity.fields) {
      if (RESERVED_COLUMNS.has(field.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${field.name}" is reserved`,
          path: ["fields"],
        });
      }
      if (seen.has(field.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate field "${field.name}"`,
          path: ["fields"],
        });
      }
      seen.add(field.name);
    }
  });
export type AppEntity = z.infer<typeof appEntitySchema>;

export const appThemeSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  radius: z.number().int().min(0).max(24),
  dark: z.boolean(),
});
export type AppTheme = z.infer<typeof appThemeSchema>;

export const appSpecSchema = z
  .object({
    name: z.string().min(1).max(60),
    tagline: z.string().min(1).max(160),
    theme: appThemeSchema,
    entities: z.array(appEntitySchema).min(1).max(4),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    for (const entity of spec.entities) {
      if (seen.has(entity.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate entity "${entity.name}"`,
          path: ["entities"],
        });
      }
      seen.add(entity.name);
    }
  });
export type AppSpec = z.infer<typeof appSpecSchema>;

const builderFor = (field: AppField): ColumnBuilder => {
  switch (field.type) {
    case "text":
      return text();
    case "longtext":
      return longText();
    case "integer":
      return integer();
    case "boolean":
      return boolean();
    case "date":
      return text();
  }
};

/**
 * Entity tables carry server-owned ownership and creation columns. Ownership
 * filtering happens in SQL, never in client code.
 */
export const appSpecToSchema = (spec: AppSpec): SchemaDefinition =>
  defineSchema(
    spec.entities.map((entity) => {
      const columns: Record<string, ColumnBuilder> = {
        owner_id: text().notNull(),
      };
      for (const field of entity.fields) {
        const builder = builderFor(field);
        columns[field.name] = field.required ? builder.notNull() : builder;
      }
      columns["created_at"] = text().notNull();
      return defineTable(entity.name, columns);
    }),
  );

export const findEntity = (
  spec: AppSpec,
  name: string,
): AppEntity | undefined => spec.entities.find((entity) => entity.name === name);
