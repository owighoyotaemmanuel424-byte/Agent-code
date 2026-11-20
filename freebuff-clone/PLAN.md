# Execution plan

Six phases, strictly ordered. A phase closes only when its gate is green, and
the next phase does not start before approval. `bun run check` (lint → typecheck
→ unit) is the minimum bar for every phase; each phase adds its own gate suite.

---

## Phase 0 — Foundation (complete)

**Build**

- `package.json`, `tsconfig.json` — Bun workspaces, strict TS, path aliases.
- `eslint.config.js` — flat config, `no-explicit-any` as an error.
- `vitest.config.ts`, `tests/unit/` — unit harness.
- `.github/workflows/freebuff-clone.yml` — lint → typecheck → test.
- `infra/docker-compose.yml`, `infra/Dockerfile.sandbox` — Postgres and the
  isolated sandbox base image.
- `packages/shared/src/*` — branded ids, errors/results, models, tools, agent
  events, sessions, quota, ads, timestamps, surfaces, plan tiers.

**Gate:** `bun run check` clean; CI workflow green on the skeleton.

---

## Phase 1 — Agent runtime

**Build**

- `packages/agent-runtime/`
  - `loop.ts` — step machine: model → tool calls → results → repeat, bounded by
    `AgentLimits`, cancellable via `AbortSignal`.
  - `registry.ts` — tool registry keyed by `ToolKind`, JSON-schema generation
    from Zod parameters, argument validation before execution.
  - `tools/files.ts` — read, write, edit, coordinated multi-file patch.
  - `tools/search.ts` — ripgrep wrapper with result caps.
  - `tools/terminal.ts` — command broker (no stdio corruption, per-command
    timeout, output truncation).
  - `tools/web.ts` — fetch with allowlist, size cap, content-type handling.
  - `tools/code-map.ts` — symbol queries against `@freebuff/code-map`.
  - `subagents.ts` — parallel delegation honouring `DelegationPolicy`.
  - `stream.ts` — `AgentEvent` emitter, backpressure, cancellation.
  - `retry.ts` — exponential backoff + circuit breaker.
- `packages/llm-providers/`
  - `provider.ts` — `StreamChat` interface, tool-call assembly.
  - `deepseek.ts`, `openai.ts`, `anthropic.ts` — provider shims.
  - `config/models.json` — model catalog (`modelCatalogSchema`).
- `packages/code-map/`
  - `indexer.ts` — file walk, TS/JS parsing, symbol graph.
  - `query.ts` — definitions, references, outline, dependency edges.
- `tests/integration/agent/` — scripted prompts → expected file diffs.

**Gate:** agent edits a real fixture repo correctly on 5/5 scripted tasks, with
streaming, cancellation and a parallel-subagent scenario covered.

---

## Phase 2 — CLI

**Build**

- `apps/cli/src/index.ts` — Commander entry.
- `apps/cli/src/ui/` — OpenTUI + React screens: auth, project picker, session.
- `apps/cli/src/state/` — TanStack Query client and cache keys.
- `apps/cli/src/broker.ts` — terminal command broker bound to the sandbox.
- `apps/cli/src/history.ts` — persisted chat history.
- `packages/auth/src/` — OAuth, magic link, session issuance.
- `packages/quota/src/` — hour tracker, country config
  (`config/quota.json`), server evaluation, verification gate.
- Sponsored slot rendering through `@freebuff/ads` (inventory in Phase 5,
  contract and fallback path here).
- `tests/e2e/cli/` — Playwright-driven terminal session.

**Gate:** end-to-end demo — auth → project picker → multi-file edit → terminal
command → chat persistence, with quota enforced by the server and reflected in
the client.

---

## Phase 3 — Cloud sandbox

**Build**

- `packages/sandbox-orchestrator/`
  - `provider.ts` — sandbox interface (create/exec/stop/snapshot).
  - `docker.ts` — local provider.
  - `microvm.ts` — production provider.
  - `limits.ts` — CPU, memory, disk, wall-clock, egress policy.
  - `egress.ts` — allowlist proxy.
- `packages/auth/src/github.ts` — GitHub OAuth, repo listing, clone tokens.
- `apps/cloud/` — connect repo, live logs, preview manager, share links.
- `tests/integration/sandbox/` — isolation suite: cross-tenant filesystem,
  network egress denial, CPU/memory exhaustion.
- `tests/load/` — k6 preview-launch scenario.

**Gate:** a public GitHub repo becomes a reachable preview URL in under 120s,
and the isolation suite proves tenants cannot reach each other.

---

## Phase 4 — Web App Builder

**Build**

- `apps/web/` — prompt workspace, generation timeline, live preview, deploy.
- `packages/db/` — generated-app data layer: schema DSL, migrations engine,
  typed queries/mutations.
- `packages/auth/src/providers.ts` — Google, GitHub, magic link for generated
  apps.
- Storage adapter for generated apps (upload, signed URLs, quotas).
- Hosting adapter: build → publish → deployed URL.
- Eject-to-GitHub: create repo, push tree, return URL.
- `tests/e2e/web/` — one prompt → app with auth, DB, storage, live URL.

**Gate:** a single prompt yields a deployed app with working auth, real
database, file storage, a live URL, and a successful eject.

---

## Phase 5 — Monetization, Desktop, hardening

**Build**

- `packages/ads/` — inventory, contextual topics from local embeddings,
  weighted selection, impression accounting, label enforcement.
- `packages/quota/` — country matrix finalized, local-midnight reset, phone
  OTP verification, no rollover.
- Paid tier: ad removal, raised quota, premium model access.
- `packages/sdk/` — public client SDK + `sdk/README.md` documenting the surface.
- `apps/desktop/` — packaging, signed macOS and Windows installers.
- Security review: sandbox escape suite, OWASP Top 10, secrets scan,
  dependency audit.

**Gate:** free tier fully usable inside quota with labelled ads on every
surface; paid tier removes ads, raises quota and unlocks premium models; signed
installers exist for both operating systems; security review signed off.

---

## Standing risks

1. **Bun-only runtime.** OpenTUI requires Bun; every package must stay Bun-first
   and avoid Node-only APIs.
2. **Convex availability.** App-builder data depends on Convex; the DB package
   keeps a narrow adapter so a different real-time backend is a drop-in.
3. **MicroVM hosting** is a paid, irreversible provisioning step — it is gated
   behind explicit approval at Phase 3.
4. **Code signing** needs Apple/Microsoft certificates the operator must supply;
   Phase 5 can complete everything else first.
5. **Quota policy** is server-authoritative from Phase 2 onward; any client-only
   enforcement is treated as a defect.
