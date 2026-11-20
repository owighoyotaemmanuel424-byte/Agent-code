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

## Phase 5 UI (desktop workspaces)

The desktop shell is a tiled window manager over the same platform API: three
workspaces (`Build`, `History`, `Apps`), one to four agent sessions per
workspace, each with its own live build stream.

| Region | Content |
| --- | --- |
| Workspace switcher | `Build` / `History` / `Apps` tabs with session counts, rendered as links so the switcher works without JavaScript |
| Tile header | title, status dot and label, `Open` and close controls |
| Tile chrome | fixed 84 px slot: either the labelled sponsored row or a session meta line — never anything else |
| Tile body | NDJSON build stream (`spec → scaffolded → schema → auth → deployed`), per-tile composer, or a live preview iframe in the `Apps` workspace |

Tiling is `tiles.ts`: one full, two columns, one large plus two stacked, or a
2×2 grid, with a 14 px gutter and a maximum of four sessions per workspace. The
same module owns the ad rules for this surface (`validateWorkspaceChrome`), so
the layout is refused at render time if an ad would sit on the paid plan, be
duplicated, lose its label or overlap a stream.

Streams are real: `POST /api/tiles/:id/build` proxies the platform's NDJSON build
route through the shell's session token, appends one row per event to that
tile's session, and keeps concurrent tiles separate. Without a streaming
platform the shell replays the SDK timeline instead of faking progress.
Finished sessions stay in `History`; `Apps` tiles render the deployed URL in an
iframe.

Gate evidence:

- `tests/unit/desktop/tiles.test.ts` (7 tests) — tiling coverage and non-overlap
  for 1–4 sessions; the reserved chrome slot and the stream starting below it;
  **the ad-rotation layout-shift test**: rotating through every inventory ad
  produces byte-identical rectangles (`toStrictEqual`), so rotation cannot move
  a stream; ads refused for paid plans, duplicated slots, unlabelled markup and
  more than four tiles; NDJSON parsing ignores junk; the store caps and keeps
  history.
- `tests/integration/desktop/ui.test.ts` — switcher tabs and `aria-current`;
  tile chrome holding the single labelled ad while the stream segment and the
  sidebar contain no sponsored markup; two tiles streaming two builds
  concurrently to distinct deployed apps (6 rows each); the tile cap (409 for
  JSON, a 303 with a notice for the form); `History` and `Apps` workspaces;
  rotation returning the literal label at the reserved height; tile close;
  inline script parses.
- Browser check at 1440 and 390 CSS px with four tiles: one sponsored row, zero
  ads inside any stream, no horizontal overflow, and after clicking
  `↻ Next sponsored` every tile, chrome and stream rectangle was identical.

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

## Phase 3 UI (cloud sandboxes)

`GET /sandboxes` is a server-rendered list-detail workspace; `?sandbox=<id>`
renders the selected sandbox's detail so the page is complete without
JavaScript. The client script adds creation, share and stop/delete behaviour and
polls a non-terminal sandbox every 3s, reloading only when the phase changes.

| Region | Content |
| --- | --- |
| Left rail | GitHub connect control (explained when `GITHUB_CLIENT_ID` is unset), repository URL + branch form, server-rendered sandbox list, one labelled sponsored slot |
| Detail | phase pill, status timeline, live preview iframe + open-in-new-tab, share field with copy button, stop/delete actions, collapsible logs |

Status timeline: `apps/cloud/src/timeline.ts` maps a `SandboxPhase` to steps
(provisioning → cloning → installing → starting → running), with exactly one
animated step while work is in progress, a settled timeline at `ready`, a failed
step at `failed` and an appended `stopped` step. Every step carries `✓`, `▸`,
`✗` or `○` as well as colour, and the animation is removed under
`prefers-reduced-motion`.

Phase 3 UI gate evidence:

- `tests/unit/cloud/timeline.test.ts` — transitions for creating, cloning,
  installing, starting, ready, failed and stopped; one active step at most;
  glyphs and escaped failure detail in the markup.
- `tests/integration/cloud/ui.test.ts` — the shell renders the repository rail,
  empty state and labelled ad; after a real sandbox is created the detail has an
  iframe pointing at the live preview, a share field whose link equals
  `GET /api/sandboxes/:id/share`, the `ready` timeline and the logs; stopping
  settles the timeline and drops the iframe; unknown ids explain themselves
  inline; a configured GitHub client id becomes a real authorize link.
- No ad inside the preview pane: `previewPaneHtml` output contains no
  sponsored markup (asserted directly), and the only slot is in the left rail.
- The landing page links to `/sandboxes` from the header and footer.

Known Phase 3 UI claim: the GitHub OAuth callback (code exchange) is not
implemented because no client id/secret is configured here; the connect control
links to GitHub's authorize endpoint when `GITHUB_CLIENT_ID` is present and
explains the requirement otherwise.

## Phase 4 UI (web builder studio)

The builder is a two-pane studio: prompt and examples on the left, live preview
and post-build actions on the right, with a build log underneath. The page is
still server-rendered HTML with one inline script, no bundler and no new
dependency.

| Region | Content |
| --- | --- |
| Prompt pane | textarea, Ctrl+Enter, example chips, `Deploy app` (one hour charged on deploy) |
| Preview pane | iframe that appears when the build finishes, `Open app`, `Download source`, `Eject → GitHub` form (repo name + token, never stored), inline status text |
| Build log | `POST /api/apps/build` streams NDJSON `step` events for spec → scaffolded → schema → auth → deployed, then a `done` event with the app and URL; failures arrive as an `error` event and render as an inline row |
| Sponsored footer | one labelled slot, rendered by `buildLogSponsorFooter` as a sibling of `#build-log`; markup without the literal label is refused at render time |

Gate evidence:

- `POST /api/apps/build` shares `prepareBuild` with `POST /api/apps`, so the
  session, phone verification and hour charge cannot drift between the JSON and
  streaming routes. The JSON route keeps its stable `design/scaffold/deploy`
  timeline; the stream names the finer steps.
- `tests/integration/web/ui.test.ts` — two-pane markup, action wiring and the
  inline script parsing; the streamed steps arrive in order with details and end
  with the deployed URL, which then serves the app; the eject bundle downloads
  and Eject → GitHub refuses an empty token; the sponsored footer rejects
  unlabelled markup and the build-log and preview segments contain no sponsored
  markup.
- `tests/integration/web/gate.test.ts` and `tests/integration/phase5/gate.test.ts`
  still pass unchanged (they assert the JSON timeline and labelled landing ad).
- Visual check at 1440 and 390 CSS px: two panes side by side, log and sponsored
  footer below, no horizontal overflow (`scrollWidth == clientWidth`).

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
