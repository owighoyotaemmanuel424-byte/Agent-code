import { describe, expect, it } from "vitest";
import {
  AuthService,
  InMemoryAuthStore,
  hashToken,
  readTokenPayload,
  signToken,
} from "@freebuff/auth";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const NOW = new Date("2026-11-19T12:00:00.000Z");

const createService = (
  overrides: Partial<ConstructorParameters<typeof AuthService>[0]> = {},
): { service: AuthService; store: InMemoryAuthStore } => {
  const store = new InMemoryAuthStore();
  const service = new AuthService({ store, secret: SECRET, now: () => NOW, ...overrides });
  return { service, store };
};

describe("signed tokens", () => {
  it("rejects a tampered payload", () => {
    const token = signToken({ kind: "session", sub: "user-1", exp: 9999999999 }, SECRET);
    expect(readTokenPayload(token, SECRET)).toMatchObject({ sub: "user-1" });

    const [body] = token.split(".");
    const forged = `${body}.deadbeef`;
    expect(readTokenPayload(forged, SECRET)).toBeUndefined();
    expect(readTokenPayload(token, "another-secret-at-least-32-characters")).toBeUndefined();
  });

  it("hashes tokens deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("magic link sign-in", () => {
  it("issues a working session and stores only hashes", async () => {
    const { service, store } = createService();
    const link = await service.requestMagicLink("Dev@Example.com");
    expect(store.magicLinks.has(hashToken(link.token))).toBe(true);

    const { sessionToken, user } = await service.completeMagicLink(link.token);
    expect(user.email).toBe("dev@example.com");
    expect(sessionToken).toBeTruthy();
    expect(store.sessions.has(hashToken(sessionToken))).toBe(true);

    const verified = await service.verifySession(sessionToken);
    expect(verified.id).toBe(user.id);
  });

  it("refuses to reuse a magic link", async () => {
    const { service } = createService();
    const link = await service.requestMagicLink("dev@example.com");
    await service.completeMagicLink(link.token);
    await expect(service.completeMagicLink(link.token)).rejects.toThrow(/already been used/);
  });

  it("refuses an expired magic link", async () => {
    let now = NOW;
    const store = new InMemoryAuthStore();
    const service = new AuthService({
      store,
      secret: SECRET,
      now: () => now,
      magicLinkTtlMs: 1000,
    });
    const link = await service.requestMagicLink("dev@example.com");
    now = new Date(NOW.getTime() + 2000);
    await expect(service.completeMagicLink(link.token)).rejects.toThrow(/expired/);
  });

  it("rejects invalid email addresses", async () => {
    const { service } = createService();
    await expect(service.requestMagicLink("not-an-email")).rejects.toThrow(/valid email/);
  });

  it("invalidates the session on logout", async () => {
    const { service } = createService();
    const link = await service.requestMagicLink("dev@example.com");
    const { sessionToken } = await service.completeMagicLink(link.token);
    await service.logout(sessionToken);
    await expect(service.verifySession(sessionToken)).rejects.toThrow(/Not signed in/);
  });

  it("rejects a session token signed with another secret", async () => {
    const { service } = createService();
    const forged = signToken(
      { kind: "session", sub: "someone", exp: 9999999999 },
      "another-secret-at-least-32-characters",
    );
    await expect(service.verifySession(forged)).rejects.toThrow(/Not signed in/);
  });

  it("requires a secret with real entropy", () => {
    expect(
      () => new AuthService({ store: new InMemoryAuthStore(), secret: "short" }),
    ).toThrow(/at least 32/);
  });
});
