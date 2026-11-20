# tests

- `unit/` — Vitest unit tests (Phase 0+).
- `integration/` — cross-package integration tests (Phase 1+).
- `e2e/` — Playwright end-to-end tests (Phase 2+).
- `load/` — k6 load scenarios (Phase 3+).

Test doubles live only here. Production paths never import from this directory.
