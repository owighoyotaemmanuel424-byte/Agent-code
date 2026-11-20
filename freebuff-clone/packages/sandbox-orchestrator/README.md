# @freebuff/sandbox-orchestrator (Phase 3)

Sandbox lifecycle: Docker providers locally, microVM in production. Read-only
base filesystem, per-tenant volumes, egress allowlist, CPU/memory limits.

Status: implemented (Phase 3). Docker provider with isolation flags, non-isolated local provider for development, stack detection, preview readiness, tenant manager. Container execution not verified on this machine (no Docker daemon access).
