# Decisions

Ambiguities resolved with the simplest implementation consistent with the
product spec. Each entry records the choice and why.

## D1 — This monorepo lives in `freebuff-clone/`

The repository already contains an unrelated, working Next.js + Convex chatbot
application at its root. The specification names the platform root
`freebuff-clone/`, so the platform is built there and the existing application
is left untouched. No existing files were moved, edited or deleted.

Consequence: `bun run check` is executed from `freebuff-clone/`. A separate CI
workflow (`.github/workflows/freebuff-clone.yml`) runs it, so the existing
workflow keeps its current behaviour.

## D2 — Source-first workspace packages

Packages publish `./src/index.ts` as their entrypoint and are consumed directly
by Bun and Vitest. No build step is needed for the runtime or tests in Phases
0–1; bundling arrives with the CLI/Desktop build pipeline, where a real artifact
is required.

## D3 — Zod is the single validation layer

All contracts are Zod schemas with inferred TypeScript types. Tool parameters
are Zod schemas too, so the runtime generates provider JSON schema and validates
arguments from one definition rather than keeping a parallel type.

## D4 — Quota policy and model catalog are data, not code

`countryQuotaConfigSchema` and `modelCatalogSchema` exist in Phase 0; the actual
values live in `packages/quota/config/quota.json` and
`packages/llm-providers/config/models.json`. No quota number or model name is
hardcoded in a runtime path.

## D5 — Ad targeting never leaves the platform

`AdTargeting` carries topic labels, not prompts. Topics are derived from a local
embedding of the prompt. Impression records contain ad id, slot, surface,
session id and timestamp only.

## D6 — Errors carry codes, not payloads

`toErrorPayload` deliberately drops `details` from the wire shape so a caller
cannot accidentally ship prompt text, tokens or customer data to a client.

## D7 — Sandbox base runs unprivileged and read-only

The sandbox image has no root user at runtime, drops all capabilities, and the
compose profile gives it an internal network. Phase 3 adds the egress allowlist
proxy rather than relaxing this default.

## D8 — Web App Builder backend

The spec allows "Convex or equivalent real-time DB". Convex is the default, but
it is consumed through `packages/db` adapters so provider coupling stays in one
package. Postgres holds platform metadata only.

## D9 — Phase 2 runs the authoritative services in-process

`PlatformClient` is the boundary the CLI talks to. In Phase 2 the only
implementation wraps `AuthService` and `QuotaService` against a single-user file
store, so enforcement lives in the packages rather than the renderer. A hosted
implementation of the same interface arrives with the platform API in Phase 3;
no CLI caller changes.

## D10 — Sponsored inventory is local configuration

Free-tier inventory lives in `apps/cli/config/ads.json` and contextual topics are
derived locally from the prompt with a keyword heuristic. Nothing about the
prompt leaves the machine. Phase 5 adds embedding-based topics and hosted
inventory behind the existing `selectSponsoredAd` contract.

## D11 — Quota charges a full hour up front

"Unlimited messages within an active hour" is implemented by charging 3,600
seconds when an hour is opened, then reusing that hour until it expires. A turn
that would need a new hour is refused if fewer than 3,600 seconds remain, which
keeps the accounting integer and auditable.

## D12 — CLI state is per-install and owner-only

State lives under `$FREEBUFF_HOME` (falling back to XDG state). Credentials,
the auth signing secret and platform state are written atomically with `0600`.
The signing secret is generated with 256 bits of entropy on first use.

## D13 — Per-file JSX source for the terminal UI

The repo keeps `jsx: react-jsx` for web surfaces; files under `apps/cli/src/ui`
use a `/** @jsxImportSource @opentui/react */` pragma so OpenTUI's intrinsic
elements resolve without changing the global JSX configuration.

## D14 — Container isolation is implemented; local previews are explicit

`DockerSandboxProvider` is the sandbox path: per-tenant network and volume,
read-only root, `--cap-drop ALL`, `no-new-privileges`, memory/CPU/PID limits and
a loopback-published preview port. Because this machine's Docker socket is
root-only, `LocalProcessPreviewProvider` exists so the pipeline can be measured
where containers cannot run. It refuses to construct unless
`allowUnsafeLocalProcess: true`, is labelled "NOT isolated", and must never be
the production choice.

## D15 — One runtime interface, two providers

`SandboxProvider` is the only type the manager and the HTTP surface know. Docker
is the local implementation; the production microVM provider replaces it by
implementing the same interface plus `ContainerRuntime`-level isolation.

## D16 — Clone URLs are HTTPS-only, file:// is a dev flag

`buildCloneUrl` rejects non-HTTPS remotes. `allowFileProtocol` exists solely on
the local provider for fixtures and is not reachable from server configuration
unless local previews are explicitly enabled.

## D17 — Cloud API is single-tenant until hosted auth

The Phase 3 HTTP surface uses one `local` tenant and exposes no tenant data on
the landing page. Multi-tenant authorization is enforced and tested inside
`SandboxManager`; wiring it to session auth happens with the hosted platform
API, so no request can currently read another tenant's sandbox.

## D18 — Generated app data lives in per-app SQLite behind a repository boundary

`@freebuff/db` implements a schema DSL, additive migrations and typed
repositories on `node:sqlite`, which both Bun and Node provide. Each generated
app gets its own database file. The phase plan names Convex for app data; that
remains an adapter swap behind the same schema/repository boundary, not a
rewrite of the builder.

## D19 — The model chooses a spec; the platform writes the code

The builder asks the model for one validated JSON spec, then scaffolds the
client deterministically. This keeps generated output consistent, testable and
free of model-authored injection risks, and makes the whole gate run in
milliseconds. Free-form code generation can be added later as an alternative
generator behind the same `buildApp` step.

## D20 — Ownership is a server column, not a client field

Every generated table carries `owner_id` and `created_at`. Inserts set the owner
from the verified session; list/count filters and delete checks compare against
it in SQL. A client cannot pass `owner_id` (unknown fields are rejected), and a
row belonging to another account returns 403.

## D21 — Local hosting behind a hosting interface

`HostingAdapter.publish` is the boundary. The local adapter writes an immutable
build directory served by the web surface; a CDN/object-store adapter can be
dropped in without changing the builder. "Deployed" today therefore means
reachable on the platform's own origin, not a public CDN URL.

## D22 — Eject is a tarball plus GitHub REST, never a stored token

`GET /eject` streams a deterministic tar.gz. GitHub eject takes a caller-supplied
token per request, creates a private repo and pushes each file through the REST
API (no git binary or shell), and never persists the token. The live push was
tested against a local GitHub-compatible server.

## D23 — One entitlement mapping per plan

`resolveEntitlements(quota, plan)` returns hours, ad eligibility and premium
model access together. Quota evaluation, the ad engine and model selection all
read that one result, so no surface can assemble a contradictory combination
("paid but still shown ads", "free with premium models"). `adsEnabled` is
carried in every quota snapshot so a client can render the right state without
inferring it.

## D24 — Ads are served and accounted on the server

`AdEngine.serve()` selects from validated configuration, records an impression
and returns the decision in one call; paid plans get `undefined` and therefore
no impression. Clicks are recorded separately. The engine only ever receives
slot, plan, topic labels, surface and session id, and the persisted impression
holds identifiers and a timestamp — never prompt text. The label is a Zod
literal, and every renderer refuses inventory that lost it.

## D25 — Phone verification is HMAC OTP, not an SMS dependency

Phase 5 gates the free tier on a verified phone number without committing to a
provider. Codes are six digits, bound to the account and number, stored as
HMAC-SHA256, and limited by expiry, attempts and a resend cooldown. A
`sendSms` callback is optional; when it is absent the code is returned to the
caller as `delivery: "dev"`, which is the only supported path until an SMS
provider is configured.

## D26 — The paid tier sits behind `BillingProvider`

`SubscriptionService` owns the free → paid transition and only applies events a
provider verified. Two providers implement the boundary: `StripeBillingProvider`
(REST checkout sessions plus HMAC-verified webhooks, no SDK) and
`LocalBillingProvider` (no card, explicit completion route, enabled only with
`FREEBUFF_ALLOW_LOCAL_BILLING=1`). Gravity returned no payments service for this
stack, so Stripe is integrated directly; a second provider is a new
implementation of the same interface.

## D27 — Desktop is a local shell over the public SDK

The desktop app renders account, quota, apps and one labelled sidebar slot, and
sends builds through `@freebuff/sdk`. It owns no entitlement logic and holds no
provider keys; the session token is read from the environment on the server and
never rendered. Packaging compiles an unsigned binary with `bun build --compile`
and prints the codesign/signtool steps rather than pretending to sign. Signed
installers stay deferred until operator certificates exist.

## D28 — Generated apps gained a nullable owner column in place

Phase 4 apps had no owner. Phase 5 adds `owner_id` to the `apps` table with an
in-place `ALTER TABLE` when the column is missing, plus an
`(owner_id, created_at)` index. Legacy rows keep `NULL`, which the ownership
check treats as unowned; new builds always write the verified account id, and
listing/filtering happens in SQL.
