# @freebuff/sdk (Phase 5)

Public TypeScript client for the freebuff platform API. Every response is
validated with Zod before it reaches your code, and every failure is an
`AppError` with a machine-readable `code`.

Status: implemented. No runtime dependencies beyond `@freebuff/shared`; works
wherever `fetch` exists (Bun, Node 18+, browsers, Workers).

## Install and create a client

```ts
import { FreebuffClient } from "@freebuff/sdk";

const client = new FreebuffClient({
  baseUrl: "https://app.example.com",
  // token: existingSessionToken,
});
```

`fetchImpl` can be supplied for tests or custom transports. `setToken()` and
`sessionToken` manage the bearer token when you store sessions yourself.

## Surface

| Method | Endpoint | Returns |
| --- | --- | --- |
| `requestMagicLink(email)` | `POST /api/auth/magic/request` | `{ token, expiresAt, delivery }` |
| `completeMagicLink(token)` | `POST /api/auth/magic/complete` | `SdkSession` (also sets the token) |
| `me()` | `GET /api/me` | `SdkUser` |
| `quota()` | `GET /api/quota` | `{ snapshot, decision }` |
| `requestPhoneCode(phone)` | `POST /api/auth/phone/request` | `SdkPhoneChallenge` |
| `verifyPhone(phone, code)` | `POST /api/auth/phone/verify` | `void` |
| `listApps()` | `GET /api/apps` | `SdkApp[]` (your apps only) |
| `buildApp(prompt)` | `POST /api/apps` | `SdkBuild` |
| `getApp(appId)` | `GET /api/apps/:id` | `SdkApp` |
| `eject(appId)` | `GET /api/apps/:id/eject` | `Uint8Array` (gzipped tarball) |
| `ejectToGitHub(appId, { token, name? })` | `POST /api/apps/:id/eject/github` | `{ url, owner, repo, files }` |
| `listRows(appId, entity, limit?)` | `GET /api/apps/:id/data/:entity` | rows |
| `createRow(appId, entity, row)` | `POST /api/apps/:id/data/:entity` | the stored row |
| `deleteRow(appId, entity, rowId)` | `DELETE /api/apps/:id/data/:entity/:rowId` | `void` |
| `listFiles(appId)` | `GET /api/apps/:id/files` | file metadata |
| `uploadFile(appId, { name, contentType, bytes })` | `POST /api/apps/:id/files` | file metadata |
| `downloadFile(appId, fileId)` | `GET /api/apps/:id/files/:fileId` | `Uint8Array` |
| `ads({ slot, topics?, session?, surface? })` | `GET /api/ads` | `{ decision, label, plan? }` |
| `billingStatus()` | `GET /api/billing/status` | `{ plan, subscription? }` |
| `startCheckout()` | `POST /api/billing/checkout` | `{ url, reference, expiresAt }` |
| `completeLocalCheckout(reference)` | `POST /api/billing/dev/complete` | `Plan` (development only) |

Uploads are base64-encoded by the client; downloads return raw bytes.

## Example: sign in, verify, build

```ts
const { token } = await client.requestMagicLink("maker@example.com");
await client.completeMagicLink(token);

const challenge = await client.requestPhoneCode("+14155550123");
await client.verifyPhone("+14155550123", challenge.code ?? "");

const build = await client.buildApp("A recipe box with favourites");
console.log(build.url);
```

Server rules still apply: builds require a verified phone on the free tier,
consume server quota and return `verification_required` / `quota_exceeded`
otherwise. The SDK never decides entitlement locally.

## Errors

```ts
import { AppError } from "@freebuff/shared";

try {
  await client.buildApp(prompt);
} catch (error) {
  if (error instanceof AppError && error.code === "quota_exceeded") {
    // show the reset time from client.quota()
  }
}
```

Wire errors use `{ error, code, message, retryable }`; `AppError` exposes `code`
and `retryable` and never carries prompts, tokens or credentials.

## Tests

`tests/integration/phase5/gate.test.ts` drives this client end to end against the
real web surface: sign-in, quota, phone verification, builds, the paid upgrade
and owner scoping.
