import { AppError, errorPayloadSchema } from "@freebuff/shared";
import type { AdSlot, Plan } from "@freebuff/shared";
import {
  sdkAdsSchema,
  sdkAppSchema,
  sdkBillingStatusSchema,
  sdkBuildSchema,
  sdkCheckoutSchema,
  sdkEjectGitHubSchema,
  sdkFileSchema,
  sdkFilesSchema,
  sdkPhoneChallengeSchema,
  sdkQuotaSchema,
  sdkRowsSchema,
  sdkSessionSchema,
  sdkUserSchema,
} from "./schemas";
import type {
  SdkAds,
  SdkApp,
  SdkBillingStatus,
  SdkBuild,
  SdkCheckout,
  SdkEjectGitHub,
  SdkPhoneChallenge,
  SdkQuota,
  SdkSession,
  SdkUser,
} from "./schemas";

export interface FreebuffClientOptions {
  /** Origin of the platform API, for example `https://api.example.com`. */
  readonly baseUrl: string;
  /** Session token from magic-link or OTP sign-in. */
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const errorFrom = async (response: Response): Promise<AppError> => {
  const text = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const payload = errorPayloadSchema.safeParse(parsed);
  return new AppError({
    code: payload.success ? payload.data.code : "internal",
    message: payload.success
      ? payload.data.message
      : `Request failed with HTTP ${String(response.status)}`,
    retryable: payload.success ? payload.data.retryable : false,
  });
};

/**
 * Public client for the freebuff platform API. Every response is validated
 * before it reaches the caller, and every failure becomes an `AppError` with a
 * machine-readable code. Works in any runtime with `fetch` (Bun, Node, browsers).
 */
export class FreebuffClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: string | undefined;

  constructor(options: FreebuffClientOptions) {
    this.baseUrl = trimBase(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token;
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  get sessionToken(): string | undefined {
    return this.token;
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (this.token !== undefined) {
      headers["authorization"] = `Bearer ${this.token}`;
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw await errorFrom(response);
    }
    return response;
  }

  private async getJson<T>(
    path: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const response = await this.send("GET", path);
    return parse(await response.json());
  }

  // --- accounts ---------------------------------------------------------

  async requestMagicLink(email: string): Promise<{
    readonly token: string;
    readonly expiresAt: string;
    readonly delivery: string;
  }> {
    const response = await this.send("POST", "/api/auth/magic/request", { email });
    return (await response.json()) as {
      token: string;
      expiresAt: string;
      delivery: string;
    };
  }

  async completeMagicLink(token: string): Promise<SdkSession> {
    const response = await this.send("POST", "/api/auth/magic/complete", { token });
    const session = sdkSessionSchema.parse(await response.json());
    this.token = session.sessionToken;
    return session;
  }

  async me(): Promise<SdkUser> {
    const body = await this.getJson("/api/me", (value) => value as { user: unknown });
    return sdkUserSchema.parse(body.user);
  }

  async quota(): Promise<SdkQuota> {
    return this.getJson("/api/quota", (value) => sdkQuotaSchema.parse(value));
  }

  // --- phone verification ----------------------------------------------

  async requestPhoneCode(phone: string): Promise<SdkPhoneChallenge> {
    const response = await this.send("POST", "/api/auth/phone/request", { phone });
    return sdkPhoneChallengeSchema.parse(await response.json());
  }

  async verifyPhone(phone: string, code: string): Promise<void> {
    await this.send("POST", "/api/auth/phone/verify", { phone, code });
  }

  // --- apps -------------------------------------------------------------

  async listApps(): Promise<SdkApp[]> {
    const body = await this.getJson("/api/apps", (value) => value as { apps: unknown });
    return sdkAppSchema.array().parse(body.apps);
  }

  async buildApp(prompt: string): Promise<SdkBuild> {
    const response = await this.send("POST", "/api/apps", { prompt });
    return sdkBuildSchema.parse(await response.json());
  }

  async getApp(appId: string): Promise<SdkApp> {
    const body = await this.getJson(`/api/apps/${encodeURIComponent(appId)}`, (value) => value as { app: unknown });
    return sdkAppSchema.parse(body.app);
  }

  async eject(appId: string): Promise<Uint8Array> {
    const response = await this.send(
      "GET",
      `/api/apps/${encodeURIComponent(appId)}/eject`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async ejectToGitHub(
    appId: string,
    input: { readonly token: string; readonly name?: string },
  ): Promise<SdkEjectGitHub> {
    const response = await this.send(
      "POST",
      `/api/apps/${encodeURIComponent(appId)}/eject/github`,
      {
        token: input.token,
        ...(input.name === undefined ? {} : { name: input.name }),
      },
    );
    return sdkEjectGitHubSchema.parse(await response.json());
  }

  // --- generated app data ----------------------------------------------

  async listRows(
    appId: string,
    entity: string,
    limit = 50,
  ): Promise<Record<string, unknown>[]> {
    const body = await this.getJson(
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}?limit=${String(limit)}`,
      (value) => value as { rows: unknown },
    );
    return sdkRowsSchema.parse(body).rows;
  }

  async createRow(
    appId: string,
    entity: string,
    row: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const response = await this.send(
      "POST",
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}`,
      row,
    );
    const body = (await response.json()) as { row: unknown };
    return sdkRowsSchema.shape.rows.element.parse(body.row);
  }

  async deleteRow(appId: string, entity: string, rowId: string): Promise<void> {
    await this.send(
      "DELETE",
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(rowId)}`,
    );
  }

  // --- files ------------------------------------------------------------

  async listFiles(appId: string) {
    const body = await this.getJson(
      `/api/apps/${encodeURIComponent(appId)}/files`,
      (value) => value as { files: unknown },
    );
    return sdkFilesSchema.parse(body).files;
  }

  async uploadFile(
    appId: string,
    input: {
      readonly name: string;
      readonly contentType: string;
      readonly bytes: Uint8Array;
    },
  ) {
    const response = await this.send(
      "POST",
      `/api/apps/${encodeURIComponent(appId)}/files`,
      {
        name: input.name,
        contentType: input.contentType,
        contentBase64: toBase64(input.bytes),
      },
    );
    const body = (await response.json()) as { file: unknown };
    return sdkFileSchema.parse(body.file);
  }

  async downloadFile(appId: string, fileId: string): Promise<Uint8Array> {
    const response = await this.send(
      "GET",
      `/api/apps/${encodeURIComponent(appId)}/files/${encodeURIComponent(fileId)}`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  // --- ads and billing --------------------------------------------------

  async ads(input: {
    readonly slot: AdSlot;
    readonly topics?: readonly string[];
    readonly session?: string;
    readonly surface?: "cli" | "desktop" | "web" | "cloud";
  }): Promise<SdkAds> {
    const params = new URLSearchParams({ slot: input.slot });
    if (input.topics !== undefined && input.topics.length > 0) {
      params.set("topics", input.topics.join(","));
    }
    if (input.session !== undefined) {
      params.set("session", input.session);
    }
    if (input.surface !== undefined) {
      params.set("surface", input.surface);
    }
    return this.getJson(`/api/ads?${params.toString()}`, (value) =>
      sdkAdsSchema.parse(value),
    );
  }

  async billingStatus(): Promise<SdkBillingStatus> {
    return this.getJson("/api/billing/status", (value) =>
      sdkBillingStatusSchema.parse(value),
    );
  }

  async startCheckout(): Promise<SdkCheckout> {
    const response = await this.send("POST", "/api/billing/checkout");
    return sdkCheckoutSchema.parse(await response.json());
  }

  /** Local development only; production checkouts complete via webhook. */
  async completeLocalCheckout(reference: string): Promise<Plan> {
    const response = await this.send("POST", "/api/billing/dev/complete", {
      reference,
    });
    const body = (await response.json()) as { plan: Plan };
    return body.plan;
  }
}
