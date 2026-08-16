export interface CloudflareBindings {
  FILES: R2Bucket;
  DOCUMENT_QUEUE: Queue;
  OPENAI_API_KEY?: string;
}

export function getCloudflareBindings(): CloudflareBindings | null {
  const global = globalThis as typeof globalThis & { __CF_ENV__?: CloudflareBindings };
  return global.__CF_ENV__ ?? null;
}
