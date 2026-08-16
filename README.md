# AI Chatbot Platform

Production-oriented AI chatbot platform built with Next.js, OpenAI, Cloudflare Workers, and Convex.

## Stack

- Next.js 15
- React 19
- AI SDK 5 with OpenAI
- Convex for application data, usage, workspaces, conversations, messages, subscriptions, and sessions
- Cloudflare Workers / OpenNext
- Cloudflare R2 for files
- Cloudflare Vectorize for knowledge retrieval
- Cloudflare Queues for document processing
- Cloudflare Rate Limiting for chat protection

## Convex migration

The project is migrating from Prisma/PostgreSQL to Convex in phases so authentication and production traffic are not broken during the transition.

The new Convex schema lives in `convex/schema.ts` and mirrors the existing application entities. `convex/authBridge.ts` provides a server-side migration bridge for the existing session system, while `convex/usage.ts` provides the atomic usage-ledger mutation.

Convex's Next.js authentication support is still evolving, so the current migration preserves the application's existing authentication boundary while moving persistence behind a controlled server-side bridge. See the Convex Next.js authentication documentation before switching the user-facing auth provider.

### Required Convex variables

```env
NEXT_PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud"
CONVEX_SERVICE_KEY="your-server-only-service-secret"
```

`NEXT_PUBLIC_CONVEX_URL` is public. `CONVEX_SERVICE_KEY` is server-only and must never be exposed to browser code.

### Development

```bash
npm install
npm run convex:dev
```

### Production backend deployment

```bash
npm run convex:deploy
```

Convex deployment validates the schema, generates the Convex client code, and pushes functions and schema to the selected deployment.

## Cloudflare deployment

The Worker entry point is `cloudflare-worker.ts`, and the OpenNext build output is deployed with Wrangler.

Generate Cloudflare environment types:

```bash
npm run cloudflare:types
```

Build and preview locally:

```bash
npm run preview
```

Deploy:

```bash
npm run deploy
```

Configure production secrets through Cloudflare or your deployment environment. Do not place secrets in `wrangler.toml`, source files, or this README.

Required production secrets include:

- `OPENAI_API_KEY`
- `AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_SERVICE_KEY`

The legacy `DATABASE_URL` remains required only until the Prisma-to-Convex cutover is completed.

Cloudflare resources referenced by the Worker include the R2 bucket, Vectorize index, document queue, AI binding, and chat rate limiter defined in `wrangler.toml`.

## CI

GitHub Actions should validate both the legacy Prisma compatibility layer and the Convex schema/code generation until the database cutover is complete.

## Security

If a credential is ever committed accidentally, rotate it immediately. Removing it from the latest file alone does not invalidate a credential that may exist in Git history.

## Migration status

- Phase 1: Convex schema and migration bridge added.
- Phase 2: Move authentication, workspace authorization, conversations, documents, subscriptions, and usage reads/writes to Convex.
- Phase 3: Remove Prisma/PostgreSQL dependencies and `DATABASE_URL`.
- Phase 4: Deploy Convex production backend and run Cloudflare smoke tests.
