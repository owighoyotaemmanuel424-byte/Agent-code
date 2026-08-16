import { extractPlainText, supportedTextMime } from "@/lib/document-extract";
import { indexTextDocument } from "@/lib/indexing";
import type { VectorizeIndex } from "@/lib/vectorize";

export interface DocumentIndexJob {
  key: string;
  name: string;
  type: string;
  documentId: string;
  workspaceId: string;
  ownerId: string;
}

export async function processDocumentJob(
  job: DocumentIndexJob,
  env: { FILES: R2Bucket; KNOWLEDGE_INDEX: VectorizeIndex; OPENAI_API_KEY: string },
) {
  if (!supportedTextMime(job.type)) {
    throw new Error(`Unsupported indexing type: ${job.type}`);
  }

  const object = await env.FILES.get(job.key);
  if (!object) throw new Error(`File not found: ${job.key}`);

  const text = await extractPlainText(object);
  if (!text.trim()) throw new Error("Document contains no indexable text");

  return indexTextDocument({
    index: env.KNOWLEDGE_INDEX,
    apiKey: env.OPENAI_API_KEY,
    documentId: job.documentId,
    workspaceId: job.workspaceId,
    ownerId: job.ownerId,
    text,
  });
}
