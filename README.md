# AI Chatbot Platform

Production-oriented AI chatbot platform built with Next.js, Prisma/PostgreSQL, OpenAI, and Cloudflare Workers.

## Stack

- Next.js 15
- React 19
- AI SDK 5 with OpenAI
- Prisma 6 + PostgreSQL
- Cloudflare Workers / OpenNext
- Cloudflare R2 for files
- Cloudflare Vectorize for knowledge retrieval
- Cloudflare Queues for document processing
- Cloudflare Rate Limiting for chat protection

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a local `.env` file. Never commit production credentials.

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
OPENAI_API_KEY="your-openai-api-key"
OPENAI_MODEL="gpt-4o-mini"
```

### 3. Generate Prisma client

```bash
npm run db:generate
```

### 4. Validate the database schema

```bash
npx prisma validate
```

For local development migrations:

```bash
npm run db:migrate
```

### 5. Run the application

```bash
npm run dev
```

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

- `DATABASE_URL`
- `OPENAI_API_KEY`

Cloudflare resources referenced by the Worker include the R2 bucket, Vectorize index, document queue, AI binding, and chat rate limiter defined in `wrangler.toml`.

## CI

GitHub Actions validates the Prisma schema, generates the Prisma client, runs TypeScript checking, and builds the production application.

## Security

If a credential is ever committed accidentally, rotate it immediately. Removing it from the latest file alone does not invalidate a credential that may exist in Git history.

## Project status

The platform includes authentication, workspace authorization, RAG/knowledge retrieval, plan-based usage enforcement, and usage ledger recording. Production deployment still requires configuring the actual database and Cloudflare/OpenAI secrets and successfully running CI.
