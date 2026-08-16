interface CloudflareEnv {
  AI: Ai;
  FILES: R2Bucket;
  KNOWLEDGE_INDEX: VectorizeIndex;
  DOCUMENT_QUEUE: Queue;
  OPENAI_API_KEY: string;
  APP_ENV?: string;
}

declare global {
  interface Env extends CloudflareEnv {}
}

export {};
