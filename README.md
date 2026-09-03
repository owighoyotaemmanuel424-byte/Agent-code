# AI Chatbot Platform

Production-oriented AI chatbot platform built with Next.js, OpenAI, Cloudflare Workers/OpenNext, and Convex.

## Stack

- Next.js 15 / App Router
- React 19
- AI SDK 5 with OpenAI
- Convex for application data, usage, workspaces, conversations, messages, subscriptions, and sessions
- Cloudflare Workers with OpenNext
- Cloudflare R2 for files
- Cloudflare Vectorize for knowledge retrieval
- Cloudflare Queues for document processing
- Cloudflare Rate Limiting for chat protection

## Cloudflare deployment

The production target is **Cloudflare Workers** using the OpenNext adapter. Cloudflare currently recommends vinext for new Next.js projects, but OpenNext remains a supported path for existing OpenNext applications such as this project.

The repository's `wrangler.jsonc` is the source of truth for the Worker configuration and bindings.

### Build locally

```bash
npm install
npm run build:next
```

### Build the Cloudflare Worker

```bash
npm run build:cloudflare
```

This runs the OpenNext Cloudflare build and produces the `.open-next` deployment output.

### Preview in the Workers runtime

```bash
npm run preview
```

### Deploy

```bash
npm run deploy
```

Cloudflare Workers Builds should use:

- **Build command:** `npx @opennextjs/cloudflare build`
- **Deploy command:** `npx @opennextjs/cloudflare deploy`
- **Production branch:** `main`

The repository scripts wrap the same OpenNext build and Wrangler deployment flow.

## Cloudflare Workers Builds setup

Connect this GitHub repository to Cloudflare Workers Builds and use `main` as the production branch.

Configure the following under the Cloudflare project's **Build variables and secrets**. Never commit secret values to GitHub.

### Required variables and secrets

```text
NEXT_PUBLIC_APP_URL=https://YOUR-WORKERS-DOMAIN
NEXT_PUBLIC_CONVEX_URL=https://YOUR-CONVEX-DEPLOYMENT.convex.cloud
OPENAI_API_KEY=<secret>
AUTH_SECRET=<secret>
CONVEX_SERVICE_KEY=<server-only secret>
CONVEX_DEPLOY_KEY=<Convex production deploy key>
```

`NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_CONVEX_URL` are public configuration values. `OPENAI_API_KEY`, `AUTH_SECRET`, `CONVEX_SERVICE_KEY`, and `CONVEX_DEPLOY_KEY` are secrets and must remain server-side.

`CONVEX_DEPLOY_KEY` is used by non-interactive CI/CD environments to deploy Convex functions and schema. Create a production-scoped deploy key in Convex and add it to Cloudflare as a secret rather than placing it in source control.

The legacy `DATABASE_URL` remains required only while the Prisma-to-Convex migration is incomplete. Once all application persistence has moved to Convex, Prisma/PostgreSQL and `DATABASE_URL` can be removed.

## Cloudflare bindings

The Worker configuration defines the resources used by the application, including:

- R2 file storage
- Vectorize knowledge index
- Document processing Queue
- Workers AI
- Chat rate limiting
- Static assets/OpenNext output

After changing bindings, regenerate Cloudflare types:

```bash
npm run cloudflare:types
```

Validate the binding/configuration contract with:

```bash
npm run cloudflare:check
```

## Convex

The Convex schema is in `convex/schema.ts`. The migration is intentionally phased so the existing authentication boundary can remain operational while persistence moves to Convex.

### Local development

```bash
npm install
npm run convex:dev
```

### Deploy Convex production

```bash
npm run convex:deploy
```

For CI/CD, configure `CONVEX_DEPLOY_KEY` in the hosting environment. Convex uses that variable to select the deployment associated with the deploy key and run non-interactively.

## CI checks

Recommended deployment checks:

```bash
npm run cloudflare:types
npm run cloudflare:check
npm run typecheck
npm run convex:typecheck
npm run build:next
npm run build:cloudflare
```

## Migration status

- **Phase 1:** Convex schema and migration bridge added.
- **Phase 2:** Move authentication, workspace authorization, conversations, documents, subscriptions, and usage reads/writes to Convex.
- **Phase 3:** Remove Prisma/PostgreSQL dependencies and `DATABASE_URL`.
- **Phase 4:** Deploy Convex production backend and complete Cloudflare production smoke tests.

## Security

If a credential is ever committed accidentally, rotate it immediately. Removing it from the latest file does not invalidate a credential that may still exist in Git history.

Do not put API keys, deploy keys, authentication secrets, or service secrets in `README.md`, `wrangler.jsonc`, source files, or committed `.env` files.

## References

- Cloudflare Next.js / Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- Cloudflare OpenNext adapter: https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- OpenNext for Cloudflare: https://opennext.js.org/cloudflare/
- Convex deployment: https://docs.convex.dev/cli/reference/deploy
- Convex deploy keys: https://docs.convex.dev/cli/deploy-key-types
