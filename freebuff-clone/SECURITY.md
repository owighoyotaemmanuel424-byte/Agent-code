# Security review

Scope: the freebuff platform as built through Phase 5 — CLI, desktop shell, web
app builder, cloud surface, and the shared auth, quota, ads, billing, DB and SDK
packages. Reviewed 2026-11-20 against `tests/integration/security/review.test.ts`
plus the unit suites that pin each primitive.

This is a builder-facing review of the code in this repository. It does not
claim a third-party penetration test, and the gaps at the end are real.

## Assets and trust boundaries

| Asset | Where it lives | Who may read it |
| --- | --- | --- |
| Session tokens | Client storage; server stores only a SHA-256 hash | The account that owns it |
| Auth signing secret | Server env (`FREEBUFF_AUTH_SECRET`) or generated per process | Server only |
| Phone verification codes | HMAC-SHA256 hash in the store; plaintext only in dev delivery | Server (dev: caller) |
| Model provider keys | Server env | Server only |
| Stripe keys | Server env | Server only |
| Quota and plan state | Server store | Owner via `GET /api/quota`, `/api/me` |
| Generated app data and files | Per-app SQLite, owner-scoped SQL | The owning account |
| Ad impressions and clicks | Server store, identifiers only | Server / operations |

Everything the browser can send is untrusted: prompts, app ids, entity names,
row payloads, file metadata, webhook bodies, session and ad parameters. Nothing
in a request may set a plan, an owner, a price or a quota value.

## Controls

### Accounts and sessions

- Magic-link sign-in: single-use tokens, hashed at rest, 10-minute expiry,
  consumed atomically (`consumeMagicLink` returns false on replay).
- Sessions: signed tokens, hashed server-side, 30-day expiry, rejected when the
  signature, the stored hash or the expiry fails.
- Secrets: `AuthService` and `PhoneVerificationService` refuse secrets shorter
  than 32 characters. The web server generates an ephemeral secret and says so on
  stderr when `FREEBUFF_AUTH_SECRET` is unset.

### Phone verification (free tier)

- E.164 normalisation rejects numbers without a country code.
- Six-digit codes from `crypto.randomInt`, bound to both account and number.
- Stored as `HMAC-SHA256(secret, userId || phone || code)`; the plaintext code is
  never persisted. Comparison uses `timingSafeEqual`.
- Five-minute expiry, five attempts, 60-second resend cooldown, and a code
  requested by one account cannot verify another.
- Successful verification flips the server-side flag that quota reads.

### Quota and plan entitlements

- Quota is evaluated and charged server-side in `QuotaService.beginHour`; the
  CLI and desktop only render the resulting snapshot.
- The free tier is denied until the phone is verified
  (`verification_required`, HTTP 403); exhausted hours are `quota_exceeded`
  (HTTP 429) with the reset time.
- Plans change only inside `SubscriptionService`, driven by a verified provider
  event. No route accepts a plan from a request body.
- `resolveEntitlements` is the single mapping from plan to hours, ads and premium
  model access. `selectModelForPlan` refuses models the plan does not include.

### Billing

- Stripe is called over REST with form encoding; the price id comes from server
  configuration, never from the request.
- Webhooks require a `stripe-signature` header, an HMAC-SHA256 over
  `<timestamp>.<rawBody>`, and a timestamp inside a five-minute tolerance.
  Missing, malformed, stale or mismatched signatures are rejected with 401 before
  any plan change.
- `checkout.session.completed` activates and `customer.subscription.deleted`
  cancels; every other event is acknowledged as `ignored` without side effects.
- The local-billing short circuit (`FREEBUFF_ALLOW_LOCAL_BILLING=1`) is dev-only,
  charges no card, and its completion route returns 404 unless that flag is set.

### Advertising

- Paid plans get no decision and therefore no impression.
- Inventory is configuration validated by `adSchema`; destinations must be HTTPS
  and the label must be the literal `"Sponsored"`.
- Renderers throw rather than render an unlabelled ad; HTML escapes every field
  and marks links `rel="sponsored noopener noreferrer"`.
- Targeting carries topic labels only. Impression records hold ad id, slot,
  surface, session id and timestamp — no prompt, code or account identifiers.

### Generated apps, data and files

- Ownership is a server column (`owner_id`) written from the verified session;
  unknown request fields such as `owner_id` are rejected.
- Row reads, counts and deletes filter by owner in SQL; a foreign id returns 403.
- File uploads enforce a content-type allowlist, 2 MB per file, a per-app cap and
  a base64 body limit; downloads are `nosniff` with a sanitised filename.
- Eject bundles are read from the app's own source directory; build paths are
  resolved and rejected when they escape the build root.
- GitHub eject takes a per-request token, performs REST calls without a shell,
  and never persists the token.

### Responses and errors

- Every JSON response is `cache-control: no-store` with
  `x-content-type-options: nosniff`; HTML pages add `referrer-policy: no-referrer`.
- Errors use one envelope — `{ error, code, message, retryable }` — including
  unknown routes. Messages never contain prompts, tokens, keys or stack traces.
- Request bodies are capped (1 MB JSON, 8 MB uploads) and rejected with 422.

## Review evidence

All of the following run in `bun run test`:

| Check | Test |
| --- | --- |
| Unsigned, stale and tampered webhooks rejected before any plan change | `tests/integration/security/review.test.ts` |
| Only a verified webhook raises a plan; dev completion disabled | `tests/integration/security/review.test.ts` |
| Cross-account app read, eject and listing refused | `tests/integration/security/review.test.ts` |
| OTP stored as a 64-char HMAC, never plaintext | `tests/integration/security/review.test.ts` |
| Ad targeting does not echo prompt or topic text | `tests/integration/security/review.test.ts` |
| Uniform error envelope and security headers | `tests/integration/security/review.test.ts` |
| OTP expiry, attempts, cooldown and cross-account binding | `tests/unit/auth/phone.test.ts` |
| Local/Stripe separation, signature tolerance, sanitised provider errors | `tests/unit/auth/billing.test.ts` |
| Paid plans see no ads; impressions hold identifiers only; label fails closed | `tests/unit/ads/engine.test.ts` |
| Quota denial, local-day reset, entitlements | `tests/unit/quota/*.test.ts` |
| Premium model only on the paid tier | `tests/unit/web/model.test.ts` |
| Verification and quota gates end to end, then the paid upgrade | `tests/integration/phase5/gate.test.ts` |

## Known gaps

- **No email or SMS provider.** Magic links and OTP codes come back to the caller
  as `delivery: "dev"` when no sender is configured. That is a deliberate local
  mode, not a production delivery path; anyone able to read the response can use
  the code until it expires.
- **No HTTP edge rate limiting.** Per-number cooldowns and attempt caps exist, but
  there is no global limiter in front of the API. Deployments need one.
- **Bearer tokens in client storage.** Generated apps store the session in
  `localStorage`; a cross-site scripting bug in a generated app would expose it.
  Generated clients render via `textContent` only, but a third-party embed could
  still introduce a hole.
- **Local hosting only.** "Deployed" apps are served from the platform's own
  origin; there is no CDN isolation layer yet.
- **Stripe is implemented, not live-tested.** Checkout and webhook handling run
  against a local double; no Stripe account or real price exists in this
  environment.
- **Docker isolation is unverified here.** The sandbox image and flags are
  implemented, but this machine's Docker socket is root-only, so the container
  path has never executed.
- **Unsigned installers.** Desktop binaries are unsigned until operator
  certificates exist; Gatekeeper and SmartScreen will warn.
- **CI has not run on GitHub** for this branch, so the automated checks above are
  verified locally only.

Report a security issue privately to the repository owner rather than in a public
issue.
