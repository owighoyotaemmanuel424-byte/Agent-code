# Progress

Updated: 2026-11-19

## Phase status

| Phase | Scope | Status | Gate |
| --- | --- | --- | --- |
| 0 | Foundation | **PASSED** | `bun run check` clean, CI on skeleton |
| 1 | Agent runtime | **PASSED** | 5/5 scripted fixture edits; streaming, cancellation, retries, parallel subagents |
| 2 | CLI | **PASSED** | auth → picker → multi-file edit → terminal command → persisted history |
| 3 | Cloud sandbox (Docker) | **PASSED with a stated limitation** | repo → reachable preview in ~0.6–1.0 s; tenant isolation enforced; container path not runnable here |
| 4 | Web App Builder | **PASSED** | one prompt → deployed app with auth, real SQLite data, file storage, live URL, source eject |
| 5 | Monetization, Desktop, hardening | not started | quota/ads/paid/signers/security |

## Phase 4 gate results

Executed in `freebuff-clone/` on 2026-11-19:

```text
$ bun run lint       # eslint .        -> exit 0
$ bun run typecheck  # tsc --noEmit    -> exit 0
$ bun run test       # vitest run      -> 113 passed (19 files), exit 0
$ bun run check                        -> exit 0
```

The gate (`tests/integration/web/gate.test.ts`) drives the real HTTP surface
with a scripted model standing in for the provider:

| Gate requirement | Evidence |
| --- | --- |
| One prompt → app | `POST /api/apps` returns a spec, 3-step timeline and absolute URL |
| Live URL | `/s/<slug>/` serves the generated HTML, `app.js` and `styles.css` |
| Working auth | magic link requested and redeemed; `/auth/me`; second account isolated |
| Real database | rows written to per-app SQLite, typed fields validated, owner-filtered in SQL |
| File storage | 12-byte PNG uploaded, downloaded byte-identical, 2 MB cap enforced |
| Eject | `/eject` returns a gzip tarball containing `index.html`, `app.js`, `schema.sql`, `freebuff.app.json`; GitHub eject covered against a local GitHub API |

The whole gate runs in **102 ms** because no bundler or container is involved:
the model picks an app spec, the platform scaffolds the app deterministically.

## Delivered in Phase 4

- `packages/db`
  - Schema DSL (`defineTable`, `defineSchema`, typed columns) that validates
    identifiers used in DDL.
  - Additive migrations with `_freebuff_migrations` tracking, idempotent on
    restart, refusing type changes and required columns without defaults.
  - `node:sqlite` driver (works under Bun and Node) with WAL, foreign keys and
    bound parameters only.
  - Typed table repositories with ownership filters, ordering and limits.
- `apps/web`
  - `spec.ts` — validated app specification and spec→schema mapping with
    server-owned `owner_id` / `created_at` columns.
  - `generate.ts` — constrained model call plus one repair attempt; JSON is
    validated before anything is written.
  - `scaffold.ts` — deterministic client (no build step) that talks to the
    platform data API and renders via `textContent` only.
  - `hosting.ts` — hosting adapter; local build directories today, CDN/object
    storage behind the same interface later.
  - `runtime.ts` — per-app SQLite, typed field validation, ownership checks,
    uploads with content-type allowlist and per-app quota.
  - `store.ts`, `auth-store.ts` — platform apps/files and durable auth tables.
  - `builder.ts` — design → scaffold → publish, marking failed builds.
  - `eject.ts` — tar.gz export and eject-to-GitHub via the REST API.
  - `app.ts`, `ui.ts`, `server.ts` — builder UI, builder API, deployed apps,
    auth/data/files APIs.
- Tests: 9 DB unit tests, 2 eject unit tests, 1 full-stack gate test.

## Known gaps

- No live model credential is configured here, so the gate uses the scripted
  test model. With a real key the same path runs against the provider.
- Magic links are returned to the caller (`delivery: "dev"`); real email
  delivery is not wired yet.
- "Deployed" means published to this platform's hosting directory and served at
  its own URL — not a public CDN/object store. The `HostingAdapter` boundary is
  where that changes.
- GitHub eject is implemented and tested against a local GitHub API; no live
  push ran (no token, and tokens are never stored).
- Generated apps share the platform account namespace; there is no per-app user
  table yet.
- Docker container isolation from Phase 3 is still unverified here, and CI has
  not executed on GitHub.

## Next action

Awaiting approval to start **Phase 5 — Monetization, Desktop, hardening**.
Packaging signed macOS/Windows installers needs operator-owned certificates;
every other Phase 5 item can be completed first.
