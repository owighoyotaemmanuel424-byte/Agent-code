import type {
  R2Bucket,
  Queue,
  VectorizeIndex,
} from "@cloudflare/workers-types";

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface CloudflareBindings {
  FILES: R2Bucket;
  DOCUMENT_QUEUE: Queue;
  OPENAI_API_KEY?: string;
  CHAT_RATE_LIMITER?: RateLimiterBinding;
  KNOWLEDGE_INDEX?: VectorizeIndex;
}

export function getCloudflareBindings(): CloudflareBindings | null {
  const global = globalThis as typeof globalThis & { __CF_ENV__?: CloudflareBindings };
  return global.__CF_ENV__ ?? null;
}
