# infra

Local development infrastructure for the platform.

## Postgres

```bash
bun run sandbox:up     # docker compose -f infra/docker-compose.yml up -d postgres
bun run sandbox:down
```

Postgres holds platform metadata (users, verifications, quota ledger, ad
inventory). Generated applications get their own data layer in Phase 4.

## Sandbox runtime

`Dockerfile.sandbox` builds the base workspace image. The `sandbox-base` compose
service demonstrates the production posture locally:

- read-only root filesystem with bounded `tmpfs` for `/tmp` and `/workspace`
- all Linux capabilities dropped, `no-new-privileges`
- memory, CPU and PID limits
- a network marked `internal`, so there is no egress by default

Phase 3 replaces the network posture with an egress allowlist proxy (package
registries and the connected Git remote only) and swaps Docker for Firecracker
microVMs in production. Executed code is always assumed hostile.

## Not yet provisioned

Cloud resources (microVM host, managed Postgres, object storage, OAuth apps,
OTP provider) are provisioned only when the owning phase is approved. No
credentials belong in this repository.
