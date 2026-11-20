import { isIP } from "node:net";
import { AppError, defineTool, withTimeout } from "@freebuff/shared";
import { z } from "zod";
import { createTool } from "../registry";
import { ServiceUnavailableError } from "../errors";
import type { WebFetchResult, WebFetcher } from "./context";

const DEFAULT_MAX_BYTES = 200_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "freebuff-agent/0.1 (+https://freebuff.com)";

const PRIVATE_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
];

/** Rejects loopback, link-local and private network targets (SSRF guard). */
export const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (isIP(host) === 0) {
    return false;
  }
  return PRIVATE_RANGES.some((range) => range.test(host));
};

const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const readCapped = async (
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> => {
  if (response.body === null) {
    return { text: "", truncated: false };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
      if (text.length >= maxBytes) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text: text.slice(0, maxBytes), truncated };
};

/** HTTPS-only fetcher with an optional host allowlist and redirect validation. */
export class HttpWebFetcher implements WebFetcher {
  private readonly allowlist: readonly string[];

  constructor(allowlist: readonly string[] = []) {
    this.allowlist = allowlist.map((host) => host.toLowerCase());
  }

  private validate(url: URL): void {
    if (url.protocol !== "https:") {
      throw new AppError({
        code: "forbidden",
        message: "Only HTTPS URLs can be fetched",
      });
    }
    if (isPrivateHostname(url.hostname)) {
      throw new AppError({
        code: "forbidden",
        message: `Refusing to fetch a private address: ${url.hostname}`,
      });
    }
    if (
      this.allowlist.length > 0 &&
      !this.allowlist.some(
        (host) =>
          url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    ) {
      throw new AppError({
        code: "forbidden",
        message: `Host is not on the fetch allowlist: ${url.hostname}`,
      });
    }
  }

  async fetch(
    rawUrl: string,
    options: {
      readonly maxBytes: number;
      readonly timeoutMs: number;
      readonly signal: AbortSignal;
    },
  ): Promise<WebFetchResult> {
    let current: URL;
    try {
      current = new URL(rawUrl);
    } catch {
      throw new AppError({
        code: "validation_failed",
        message: `Not a valid URL: ${rawUrl}`,
      });
    }

    let response: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      this.validate(current);
      const target = current;
      const received = await withTimeout(
        (signal) =>
          fetch(target, {
            redirect: "manual",
            signal,
            headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json" },
          }),
        options.timeoutMs,
        options.signal,
      );
      if (received.status >= 300 && received.status < 400) {
        const location = received.headers.get("location");
        await received.body?.cancel();
        if (location === null) {
          response = received;
          break;
        }
        current = new URL(location, target);
        continue;
      }
      response = received;
      break;
    }

    if (response === undefined) {
      throw new AppError({
        code: "tool_failed",
        message: `Too many redirects fetching ${rawUrl}`,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    const { text, truncated } = await readCapped(response, options.maxBytes);
    return {
      url: current.toString(),
      status: response.status,
      contentType,
      text: contentType.includes("text/html") ? stripHtml(text) : text,
      truncated,
    };
  }
}

export const fetchUrlTool = createTool(
  defineTool({
    name: "fetch_url",
    kind: "web.fetch",
    description:
      "Fetch an HTTPS URL and return readable text. Private addresses and non-HTTPS URLs are refused.",
    parameters: z.object({
      url: z.string().url().max(4096),
      maxBytes: z.number().int().min(1000).max(1_000_000).optional(),
    }),
    mutating: false,
    timeoutMs: 30_000,
  }),
  async (args, context) => {
    if (context.web === undefined) {
      throw new ServiceUnavailableError("Web fetching");
    }
    return context.web.fetch(args.url, {
      maxBytes: args.maxBytes ?? DEFAULT_MAX_BYTES,
      timeoutMs: 20_000,
      signal: context.signal,
    });
  },
);
