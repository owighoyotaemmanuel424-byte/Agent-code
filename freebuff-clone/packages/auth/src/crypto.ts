import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Compact signed tokens: base64url(payload).base64url(HMAC-SHA256). The payload
 * is integrity-protected but not confidential, so it never carries secrets.
 */
export const signToken = (
  payload: Readonly<Record<string, unknown>>,
  secret: string,
): string => {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
};

export const readTokenPayload = (
  token: string,
  secret: string,
): Record<string, unknown> | undefined => {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return undefined;
  }
  const body = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    );
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Tokens are stored only as hashes, so a leaked database cannot be replayed. */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
