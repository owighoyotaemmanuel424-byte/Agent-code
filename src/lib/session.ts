import nodeCrypto from "node:crypto";

const crypto = nodeCrypto as any;
const secret = process.env.AUTH_SECRET || "development-only-change-me";

export function createSessionToken(userId: string) {
  const payload = `${userId}.${Date.now()}.${crypto.randomBytes(16).toString("hex")}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, issuedAt, nonce, signature] = parts;
  const payload = `${userId}.${issuedAt}.${nonce}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Date.now() - Number(issuedAt) > 1000 * 60 * 60 * 24 * 30) return null;
  return userId;
}
