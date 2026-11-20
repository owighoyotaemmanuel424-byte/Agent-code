# apps/web — Web App Builder (Phase 4)

One-prompt app generation: the model returns a validated app spec, the platform
scaffolds a working client, publishes it, and serves it at `/s/<slug>/`.

Status: implemented (Phase 4).

## Flow

1. `POST /api/apps {prompt}` → `generate.ts` asks the model for a JSON spec and
   validates it with Zod (one repair attempt).
2. `spec.ts` maps the spec to database tables, adding server-owned `owner_id`
   and `created_at`.
3. `scaffold.ts` writes `index.html`, `styles.css`, `app.js`, `schema.sql`,
   `README.md` — no build step, no arbitrary model-written code.
4. `hosting.ts` publishes the build directory; `builder.ts` records the app and
   its token usage.
5. The app calls the platform for auth, rows and files:

```text
POST /api/apps/:id/auth/request      {email}      -> magic link
POST /api/apps/:id/auth/complete     {token}      -> session token
GET  /api/apps/:id/auth/me
GET  /api/apps/:id/data/:entity
POST /api/apps/:id/data/:entity
DEL  /api/apps/:id/data/:entity/:rowId
GET  /api/apps/:id/files
POST /api/apps/:id/files             {name, contentType, contentBase64}
GET  /api/apps/:id/files/:fileId
GET  /api/apps/:id/eject                          -> source tar.gz
POST /api/apps/:id/eject/github      {token, name?}
```

## Running

```bash
cd apps/web
FREEBUFF_WEB_ROOT=/tmp/freebuff-web PORT=3002 bun run src/server.ts
```

`DEEPSEEK_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` enables generation;
without a key the UI loads but builds return a configuration error. Set
`FREEBUFF_AUTH_SECRET` (32+ chars) so sessions survive restarts.

## Boundaries

- Rows are filtered by the signed-in user's id in SQL; uploaded files are
  ownership-checked before they are read.
- Uploads are restricted to an allowlist of content types and 2 MB per file,
  20 MB per app.
- Magic links are returned in the response (`delivery: "dev"`) until an email
  provider is wired.
- Hosting is local by design; a CDN adapter implements the same
  `HostingAdapter` interface.
