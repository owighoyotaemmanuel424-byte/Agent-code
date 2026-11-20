import { describe, expect, it } from "vitest";
import { PhoneVerificationService, maskPhone, normalizePhone } from "@freebuff/auth";
import type { PhoneVerificationOptions } from "@freebuff/auth";
import { openSqliteDatabase } from "@freebuff/db";
import { SqliteAuthStore } from "../../../apps/web/src/auth-store";

const SECRET = "phone-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-11-19T12:00:00.000Z");
const PHONE = "+14155550123";

type HarnessOptions = Partial<
  Pick<
    PhoneVerificationOptions,
    "codeTtlMs" | "resendCooldownMs" | "maxAttempts" | "sendSms"
  >
>;

const createHarness = (overrides: HarnessOptions = {}) => {
  let now = NOW;
  const db = openSqliteDatabase(":memory:");
  const store = new SqliteAuthStore({ db });
  const service = new PhoneVerificationService({
    store,
    authStore: store,
    secret: SECRET,
    now: () => now,
    ...overrides,
  });
  return {
    db,
    store,
    service,
    advance: (ms: number): void => {
      now = new Date(now.getTime() + ms);
    },
  };
};

describe("phone number formatting", () => {
  it("normalizes cosmetic formatting to E.164", () => {
    expect(normalizePhone(" +1 (415) 555-0123 ")).toBe(PHONE);
    expect(normalizePhone("+44.20.7946.0958")).toBe("+442079460958");
  });

  it("requires a leading plus and a real country code", () => {
    expect(() => normalizePhone("4155550123")).toThrow(/international format/);
    expect(() => normalizePhone("+0155550123")).toThrow(/international format/);
    expect(() => normalizePhone("+1")).toThrow(/international format/);
  });

  it("masks all but the last four digits", () => {
    expect(maskPhone(PHONE)).toBe("+1••••••0123");
    expect(maskPhone(PHONE)).not.toContain("415555");
  });
});

describe("phone verification", () => {
  it("issues a dev code, stores only its hash, and verifies the account", async () => {
    const { service, store } = createHarness();
    const user = await store.createUser("dev@example.com");

    const challenge = await service.requestCode({ userId: user.id, phone: PHONE });
    expect(challenge.delivery).toBe("dev");
    expect(challenge.code).toMatch(/^\d{6}$/);
    expect(challenge.phone).toBe(PHONE);
    expect(challenge.maskedPhone).toBe("+1••••••0123");

    const record = await store.getPhoneChallenge(PHONE);
    expect(record).toBeDefined();
    expect(record?.codeHash).not.toBe(challenge.code);
    expect(record?.codeHash).toHaveLength(64);

    await service.verifyCode({
      userId: user.id,
      phone: PHONE,
      code: challenge.code ?? "",
    });
    expect((await store.findUserById(user.id))?.phoneVerified).toBe(true);
    expect(await store.getPhoneChallenge(PHONE)).toBeUndefined();
  });

  it("counts wrong attempts and locks the number after the limit", async () => {
    const { service, store } = createHarness({ maxAttempts: 5 });
    const user = await store.createUser("dev@example.com");
    const challenge = await service.requestCode({ userId: user.id, phone: PHONE });
    const wrong = challenge.code === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        service.verifyCode({ userId: user.id, phone: PHONE, code: wrong }),
      ).rejects.toThrow(/not correct/);
      expect((await store.getPhoneChallenge(PHONE))?.attempts).toBe(attempt);
    }

    await expect(
      service.verifyCode({ userId: user.id, phone: PHONE, code: challenge.code ?? "" }),
    ).rejects.toThrow(/Too many attempts/);
    expect((await store.findUserById(user.id))?.phoneVerified).toBe(false);
  });

  it("refuses an expired code and clears the challenge", async () => {
    const { service, store, advance } = createHarness({ codeTtlMs: 1000 });
    const user = await store.createUser("dev@example.com");
    const challenge = await service.requestCode({ userId: user.id, phone: PHONE });
    advance(2000);
    await expect(
      service.verifyCode({ userId: user.id, phone: PHONE, code: challenge.code ?? "" }),
    ).rejects.toThrow(/expired/);
    expect(await store.getPhoneChallenge(PHONE)).toBeUndefined();
  });

  it("enforces the resend cooldown", async () => {
    const { service, store, advance } = createHarness();
    const user = await store.createUser("dev@example.com");
    await service.requestCode({ userId: user.id, phone: PHONE });
    await expect(
      service.requestCode({ userId: user.id, phone: PHONE }),
    ).rejects.toThrow(/Wait a minute/);

    advance(61_000);
    const second = await service.requestCode({ userId: user.id, phone: PHONE });
    expect(second.delivery).toBe("dev");
  });

  it("binds a code to the account that requested it", async () => {
    const { service, store } = createHarness();
    const owner = await store.createUser("owner@example.com");
    const intruder = await store.createUser("intruder@example.com");
    const challenge = await service.requestCode({ userId: owner.id, phone: PHONE });

    await expect(
      service.verifyCode({
        userId: intruder.id,
        phone: PHONE,
        code: challenge.code ?? "",
      }),
    ).rejects.toThrow(/another account/);
    expect((await store.findUserById(owner.id))?.phoneVerified).toBe(false);
    expect((await store.findUserById(intruder.id))?.phoneVerified).toBe(false);
  });

  it("delivers over SMS when a sender is configured and hides the code", async () => {
    const sent: { phone: string; code: string }[] = [];
    const { service, store } = createHarness({
      sendSms: async (phone, code): Promise<void> => {
        sent.push({ phone, code });
      },
    });
    const user = await store.createUser("dev@example.com");
    const challenge = await service.requestCode({ userId: user.id, phone: PHONE });
    expect(challenge.delivery).toBe("sms");
    expect(challenge.code).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.phone).toBe(PHONE);

    await service.verifyCode({
      userId: user.id,
      phone: PHONE,
      code: sent[0]?.code ?? "",
    });
    expect((await store.findUserById(user.id))?.phoneVerified).toBe(true);
  });

  it("rejects a secret with too little entropy", () => {
    const store = new SqliteAuthStore({ db: openSqliteDatabase(":memory:") });
    expect(
      () =>
        new PhoneVerificationService({
          store,
          authStore: store,
          secret: "short",
        }),
    ).toThrow(/at least 32/);
  });
});
