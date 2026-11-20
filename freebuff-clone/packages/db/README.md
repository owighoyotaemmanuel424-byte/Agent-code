# @freebuff/db (Phase 4)

Data layer for generated apps: a schema DSL, additive migrations and typed
repositories backed by SQLite via `node:sqlite` (works under Bun and Node).

Status: implemented (Phase 4).

## Usage

```ts
import {
  applySchema,
  boolean,
  createTableRepository,
  defineSchema,
  defineTable,
  integer,
  openSqliteDatabase,
  text,
} from "@freebuff/db";

const schema = defineSchema([
  defineTable("notes", {
    title: text().notNull(),
    pinned: boolean().notNull().default(false),
    score: integer(),
  }),
]);

const db = openSqliteDatabase("app.sqlite");
applySchema(db, schema); // create tables / add columns, never destructive

const notes = createTableRepository(db, schema.tables[0]!);
notes.insert({ title: "First" });
notes.list({ where: { pinned: 1 }, orderBy: "id", direction: "desc" });
```

## Guarantees

- Every value is a bound statement parameter; SQL text only ever contains
  identifiers validated against `/^[a-z][a-z0-9_]*$/`.
- Migrations are forward-only: missing tables and columns are added, applied
  steps are recorded in `_freebuff_migrations`, and a type change or a required
  column without a default raises a `conflict` error instead of dropping data.
- Repositories reject unknown fields, coerce and validate typed values, and
  scope list/count queries with validated equality filters.

The Convex/real-time backend named in the phase plan would implement behind the
`SqlDatabase` + repository boundary; the builder currently uses SQLite per app
(see `DECISIONS.md`, D18).
