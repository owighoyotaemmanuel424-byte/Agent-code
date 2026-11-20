# apps/desktop — desktop shell (Phase 5)

A local desktop shell over the platform API: a tiled window manager with three
workspaces (`Build`, `History`, `Apps`), one to four agent sessions per
workspace, and a per-tile build stream. The sidebar shows the signed-in account,
server quota and the account's apps; the single `desktop.sidebar` sponsored slot
lives in tile chrome, at a reserved height, and never inside a stream. Same
runtime, same auth, same quota as the CLI and web surfaces — the shell holds no
entitlement logic of its own, and its tile layout is window state kept in memory.

Status: implemented, unsigned. Signed macOS/Windows installers are intentionally
left for when operator certificates exist.

## Run locally

```bash
cd apps/desktop
FREEBUFF_PLATFORM_URL=http://127.0.0.1:3002 \
FREEBUFF_SESSION_TOKEN=<session token from the web app> \
bun run src/server.ts
# or: bun run start
```

Environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3100` | Shell HTTP port |
| `FREEBUFF_DESKTOP_HOST` | `127.0.0.1` | Bind address; set `0.0.0.0` to expose the shell |
| `FREEBUFF_PLATFORM_URL` | `http://127.0.0.1:3002` | Platform API origin |
| `FREEBUFF_SESSION_TOKEN` | — | Session token used for server-side calls |
| `FREEBUFF_DESKTOP_OPEN` | — | `1` opens the shell in the default browser |

Routes:

| Route | Purpose |
| --- | --- |
| `GET /?workspace=build\|history\|apps` | Tiled shell page |
| `GET /api/state` | Account, quota, apps, tiles and the labelled ad decision |
| `POST /api/tiles` | Add a build tile (max four per workspace) |
| `POST /api/tiles/:id/build` | Stream that tile's build as NDJSON |
| `POST /api/tiles/:id/close` | Remove a tile |
| `GET /api/ads/rotate` | Next labelled decision for the chrome slot |
| `POST /api/build` | Non-streaming build through the SDK |

The session token is read on the server and never rendered into the page; the
bytecode/build path below does not embed it either.

## Package an unsigned binary

```bash
cd apps/desktop
bun run package
```

`scripts/package.ts` compiles `src/server.ts` with `bun build --compile` into
`dist/freebuff-desktop-<platform>-<arch>`, prints its SHA-256 and then prints the
exact steps an operator must run with their own certificates:

- macOS: `codesign --deep --force --options runtime --sign "Developer ID Application: …"`
  followed by `xcrun notarytool submit … && xcrun stapler staple …`.
- Windows: `signtool sign /fd SHA256 /tr <timestamp url> /td SHA256 /f <pfx> …`.

Until those run, the artifact is unsigned: Gatekeeper and SmartScreen will warn,
and it must not be presented as a signed release.

## Limitations

- No auto-update channel and no installer (`dmg`/`msi`) packaging yet; the
  compiled binary is the artifact.
- Tile layout, titles and stream logs are window state held in memory: restarting
  the shell starts with one empty session per workspace. Apps, quota, ads and
  plan stay server-authoritative.
- The shell has no local model access: every build goes through the platform API,
  so quota and ads stay server-authoritative.
- Signed installers need operator certificates — deferred by the user, not
  simulated here.
