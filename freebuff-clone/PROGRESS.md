# Progress

Updated: 2026-11-20

## Phase status

| Phase | Scope | Status | Gate |
| --- | --- | --- | --- |
| 0 | Foundation | **PASSED** | `bun run check` clean, CI on skeleton |
| 1 | Agent runtime | **PASSED** | 5/5 scripted fixture edits; streaming, cancellation, retries, parallel subagents |
| 2 | CLI | **PASSED** | auth → picker → multi-file edit → terminal command → persisted history |
| 3 | Cloud sandbox (Docker) | **PASSED with a stated limitation** | repo → reachable preview in ~0.6–1.0 s; tenant isolation enforced; container path not runnable here |
| 4 | Web App Builder | **PASSED** | one prompt → deployed app with auth, real SQLite data, file storage, live URL, source eject |
| 5 | Monetization, Desktop, hardening | **PASSED with a stated limitation** | labelled ads on every surface, verified free tier, quota 429, paid upgrade, public SDK, security review; signed installers deferred |

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

## Phase 5 gate results

Executed in `freebuff-clone/` on 2026-11-20:

```text
$ bun run lint       # eslint .        -> exit 0
$ bun run typecheck  # tsc --noEmit    -> exit 0
$ bun run test       # vitest run      -> 153 passed (26 files), exit 0
```

The gate (`tests/integration/phase5/gate.test.ts`, 140 ms) drives the real web
surface through the public SDK; the review
(`tests/integration/security/review.test.ts`, 59 ms) attacks it.

| Gate requirement | Evidence |
| --- | --- |
| Labelled ads everywhere | landing HTML carries `class="sponsored-ad"` and the literal `Sponsored`; `/api/ads` returns `label: "Sponsored"` with a decision for free visitors and records an impression |
| Verified free tier | unauthenticated build 401; signed-in unverified build 403 `verification_required`; wrong OTP 401; correct OTP flips `phoneVerified` |
| Quota is server-authoritative | two builds charge the two free hours (1 h up front each); the third returns 429 `quota_exceeded` with the reset time |
| Local-day reset, no rollover | next local day reports `consumedSecondsToday: 0` and a later `resetsAt` |
| Paid tier | `POST /api/billing/checkout` → `dev/complete` activates `paid`; billing status records an active local subscription |
| Paid entitlements | paid ads return `decision: null`; hours rise 2 → 8; the premium plan reaches the builder (`buildPlans` = `free, free, paid`) |
| SDK as the public contract | sign-in, `me`, `quota`, phone, build, list, ads, billing all run through `FreebuffClient` |
| Owner isolation | a second account sees zero apps and gets 403 on app detail and eject |

## Delivered in Phase 5

- `packages/quota`
  - 25-country matrix with IANA zones (US 30 h free / 60 h paid, default 5/40).
  - `resolveEntitlements` as the one plan → hours/ads/models mapping.
  - `listCountryQuotas` and `validateQuotaMatrix` (duplicates, unknown zones).
- `packages/ads`
  - Cross-surface inventory (`cli.session`, `cli.startup`, `desktop.sidebar`,
    `web.builder`, `cloud.dashboard`) parsed from configuration.
  - `AdEngine` with impression and click accounting; paid plans never served.
  - Plain-text, badge and escaped HTML renderers that fail closed without the
    `Sponsored` label and mark links `rel="sponsored noopener noreferrer"`.
- `packages/auth`
  - Phone OTP: E.164 normalisation, HMAC storage, 5-minute expiry, 5 attempts,
    60-second resend cooldown, dev or SMS delivery.
  - `SubscriptionService` plus `BillingProvider`: Stripe REST checkout and
    HMAC-verified webhooks, and a local dev provider behind a flag.
- `apps/web`
  - Routes for `/api/me`, `/api/quota`, magic links, phone, `/api/ads` and
    billing; builds gated on session, phone verification and quota.
  - SQLite quota, ad-event and subscription stores; `owner_id` added in place
    and enforced for apps, data and files.
  - Plan-aware model selection that prefers premium models on the paid tier.
- `apps/cloud` and `apps/desktop`: labelled `cloud.dashboard` and
  `desktop.sidebar` slots; desktop shell over the SDK with an unsigned
  `bun build --compile` packaging script.
- `packages/sdk`: the full public client (accounts, quota, phone, apps, rows,
  files, eject, ads, billing) with Zod-validated responses and `AppError` codes.
- `SECURITY.md`: boundaries, controls, the checks that pin them and the gaps.
- Tests: 40 new tests (matrix, ad engine, phone, billing, model selection,
  Phase 5 gate, security review).

## Phase 2 UI (design-system pass)

Screen inventory, rendered headless from one `Screen` tree and interactively
through OpenTUI:

| Screen | Builder | Ad slot | Evidence |
| --- | --- | --- | --- |
| Device auth | `buildDeviceAuthScreen` | none | code, URL and waiting state in `screens.test.ts` |
| Model picker | `buildModelPickerScreen` | one row, sibling of the list | UNLIMITED / PREMIUM groups, `▸ (recommended)`, paid hint |
| Project picker | `buildProjectPickerScreen` | one row, sibling of the list | branch label; missing / empty / non-git / permission reasons inline |
| Agent view | `buildAgentScreen` | one row between stream and composer | thinking text, tool cards, `+`/`-` diff glyphs, status bar |
| Quota dashboard | `buildQuotaDashboardScreen` | one banner above the meter | `█░` bar, "Resets in …", unlimited vs metered, upgrade banner |

Tests (all passing):

- `tests/unit/shared/theme.test.ts` — token roles, ANSI mapping (39/34/196/214/244),
  CSS variable emission, no-color painting, named run states.
- `tests/integration/cli/screens.test.ts` — every screen renders headless; stream
  subtree contains no ad node or `AdRow` element; an ad inside the stream, two
  ads, a missing label and a short row are refused; rotating creatives keeps
  line count, ad row position and post-ad lines identical; no ANSI without
  colour; folder inspection for missing / empty / non-git / valid repos.
- `tests/integration/cli/ui.test.tsx` — keyboard-only flow: model picker →
  project picker → prompt → completed run → quota dashboard (ctrl+u) → Esc quits.
- `tests/unit/web/theme.test.ts` — the web and cloud pages emit the shared
  `:root` token block.

Accessibility checks run: every state carries a glyph and a word (idle,
thinking, tool running, diff arriving, error, done); diffs carry `+`/`-` as well
as colour; `--no-color` and `NO_COLOR` produce escape-free, still-parseable
output; the pickers are operable with arrows, Enter and single-key shortcuts
with no mouse.

Ad-placement audit: CLI model picker, project picker, agent view and quota
dashboard each render at most one sponsored row; it is a sibling of the list or
stream, fixed at four rows, labelled `Sponsored`, and validated at render time.
Web builder and cloud dashboard keep their existing labelled banner; no ad is
inside a build log, diff, tool card or preview pane.

## Known gaps

- No live model credential is configured here, so gates use the scripted test
  model. With a real key the same path runs against the provider.
- Magic links and OTP codes are returned to the caller (`delivery: "dev"`); no
  email or SMS provider is wired yet.
- "Deployed" means published to this platform's hosting directory and served at
  its own URL — not a public CDN/object store. The `HostingAdapter` boundary is
  where that changes.
- GitHub eject is implemented and tested against a local GitHub API; no live
  push ran (no token, and tokens are never stored).
- Stripe checkout and webhooks are implemented and tested against a local double;
  no live Stripe account, price or webhook endpoint is configured.
- There is no HTTP edge rate limiter; only per-number OTP cooldowns and attempt
  caps exist. A deployment needs one in front of the API.
- Docker container isolation from Phase 3 is still unverified here.
- Desktop binaries are unsigned: signed macOS/Windows installers need
  operator-owned certificates and were deferred by the user.
- CI has not executed on GitHub for this branch; all results above are local.

## Next action

Phase 5 is complete apart from signed installers. Awaiting approval, then the
remaining work is operational: certificates for signed builds, live Stripe keys,
email/SMS delivery and an edge rate limiter.
