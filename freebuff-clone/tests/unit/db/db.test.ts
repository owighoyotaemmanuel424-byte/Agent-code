import { describe, expect, it } from "vitest";
import {
  applySchema,
  boolean,
  createTableRepository,
  defineSchema,
  defineTable,
  integer,
  jsonColumn,
  openSqliteDatabase,
  schemaToSql,
  text,
} from "@freebuff/db";
import type { SqlDatabase } from "@freebuff/db";

const notesSchema = () =>
  defineSchema([
    defineTable("notes", {
      title: text().notNull(),
      body: text(),
      pinned: boolean().notNull().default(false),
      meta: jsonColumn(),
    }),
  ]);

const withDb = <T>(work: (db: SqlDatabase) => T): T => {
  const db = openSqliteDatabase(":memory:");
  try {
    return work(db);
  } finally {
    db.close();
  }
};

describe("schema DSL", () => {
  it("adds an id primary key and renders DDL", () => {
    const schema = notesSchema();
    expect(schema.tables[0]?.columns[0]).toMatchObject({ name: "id", primaryKey: true });
    const sql = schemaToSql(schema);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "notes"');
    expect(sql).toContain('"pinned" INTEGER NOT NULL DEFAULT 0');
  });

  it("rejects invalid identifiers", () => {
    expect(() => defineTable("Bad-Name", { title: text() })).toThrow(/identifier/);
    expect(() => defineTable("notes", { "bad-name": text() })).toThrow(/identifier/);
  });
});

describe("migrations", () => {
  it("creates tables and is idempotent", () => {
    withDb((db) => {
      const first = applySchema(db, notesSchema());
      expect(first.applied).toEqual(["create:notes"]);
      const second = applySchema(db, notesSchema());
      expect(second.applied).toEqual([]);
    });
  });

  it("adds new columns additively", () => {
    withDb((db) => {
      applySchema(db, notesSchema());
      const extended = defineSchema([
        defineTable("notes", {
          title: text().notNull(),
          body: text(),
          pinned: boolean().notNull().default(false),
          meta: jsonColumn(),
          score: integer().notNull().default(0),
        }),
      ]);
      const result = applySchema(db, extended);
      expect(result.applied).toEqual(["alter:notes.score"]);
      const repository = createTableRepository(db, extended.tables[0]!);
      const row = repository.insert({ title: "Scored" });
      expect(row["score"]).toBe(0);
    });
  });

  it("refuses a type change", () => {
    withDb((db) => {
      applySchema(db, notesSchema());
      const changed = defineSchema([
        defineTable("notes", {
          title: integer().notNull(),
        }),
      ]);
      expect(() => applySchema(db, changed)).toThrow(/additive only/);
    });
  });
});

describe("table repository", () => {
  it("round-trips booleans, JSON and nulls", () => {
    withDb((db) => {
      const schema = notesSchema();
      applySchema(db, schema);
      const repository = createTableRepository(db, schema.tables[0]!);
      const row = repository.insert({
        title: "Hello",
        body: null,
        pinned: true,
        meta: { tags: ["a", "b"] },
      });
      expect(typeof row["id"]).toBe("string");
      expect(row["pinned"]).toBe(true);
      expect(row["meta"]).toEqual({ tags: ["a", "b"] });
      expect(row["body"]).toBeNull();
      expect(row["createdAt"]).toBeUndefined();

      const found = repository.findById(String(row["id"]));
      expect(found?.["title"]).toBe("Hello");
      expect(repository.list({ where: { pinned: 1 } })).toHaveLength(1);
      expect(repository.list({ where: { pinned: 0 } })).toHaveLength(0);
      expect(repository.count({ pinned: 1 })).toBe(1);
    });
  });

  it("binds values instead of interpolating them", () => {
    withDb((db) => {
      const schema = notesSchema();
      applySchema(db, schema);
      const repository = createTableRepository(db, schema.tables[0]!);
      const attack = "Robert'); DROP TABLE notes;--";
      const row = repository.insert({ title: attack });
      expect(row["title"]).toBe(attack);
      expect(repository.count()).toBe(1);
    });
  });

  it("rejects unknown fields, wrong types and bad ordering", () => {
    withDb((db) => {
      const schema = notesSchema();
      applySchema(db, schema);
      const repository = createTableRepository(db, schema.tables[0]!);
      expect(() => repository.insert({ nope: "x" })).toThrow(/Unknown field/);
      expect(() => repository.insert({ title: 5 })).toThrow(/must be text/);
      expect(() => repository.insert({ pinned: 1 })).toThrow(/must be a boolean/);
      expect(() => repository.list({ orderBy: "missing" })).toThrow(/order by/);
      expect(() => repository.list({ limit: 10_000 })).not.toThrow();
    });
  });

  it("updates and deletes existing rows", () => {
    withDb((db) => {
      const schema = notesSchema();
      applySchema(db, schema);
      const repository = createTableRepository(db, schema.tables[0]!);
      const row = repository.insert({ title: "Before" });
      const id = String(row["id"]);
      const updated = repository.update(id, { title: "After", pinned: true });
      expect(updated?.["title"]).toBe("After");
      expect(repository.update("missing", { title: "x" })).toBeUndefined();
      expect(repository.delete(id)).toBe(true);
      expect(repository.findById(id)).toBeUndefined();
    });
  });
});
