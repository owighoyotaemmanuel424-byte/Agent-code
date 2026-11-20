# freebuff-clone

Ad-supported, multi-surface AI coding platform. One agent runtime and one
context model behind four interoperable surfaces:

| Surface | App | Package boundary |
| --- | --- | --- |
| Terminal | `apps/cli` | OpenTUI + React over `@freebuff/agent-runtime` |
| Desktop | `apps/desktop` | Shell around the CLI core |
| Web App Builder | `apps/web` | Prompt → deployed full-stack app |
| Cloud Sandbox | `apps/cloud` | GitHub → isolated sandbox → preview URL |

## Layout

```text
apps/cli  apps/desktop  apps/web  apps/cloud
packages/agent-runtime  llm-providers  code-map  sandbox-orchestrator
packages/db  auth  quota  ads  sdk  shared
infra/  tests/
```

`@freebuff/shared` owns every cross-surface contract (agent events, tools,
sessions, models, quota, ads, errors). Surfaces render from those types instead
of redefining their own.

## Commands

```bash
bun install
bun run check        # lint + typecheck + unit tests (the phase gate)
bun run lint
bun run typecheck
bun run test
bun run sandbox:up   # local Postgres
```

Requires Bun >= 1.2, Docker for the sandbox profile, Node-free runtime.

## Status

Phase 0 (foundation) is complete: monorepo, strict TypeScript, lint, Vitest, CI,
local infrastructure and the shared contract package.

Phase progress, gate results and open gaps live in [PROGRESS.md](./PROGRESS.md).
The execution plan is [PLAN.md](./PLAN.md); choices made under ambiguity are
recorded in [DECISIONS.md](./DECISIONS.md).

## Rules that shape the code

- TypeScript strict, no `any` anywhere in committed code.
- Quota and ad decisions are server-authoritative; client checks are UX only.
- Model names, country quotas and ad inventory come from configuration.
- Executed code is hostile input: read-only base filesystem, dropped
  capabilities, egress allowlist.
- Every external call has a timeout, retry policy and circuit breaker.
- Prompts, code and tokens are never logged.
