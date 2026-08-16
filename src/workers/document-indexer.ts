import { extractPlainText } from "@/lib/document-extract";
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

export interface DocumentParser {
  supports: (mimeType: string) => boolean;
  extract: (input: { bytes: ArrayBuffer; mimeType: string; name: string }) => Promise<string>;
}

export function createDocumentParserRegistry(parsers: DocumentParser[]) {
  return {
    async extract(input: { bytes: ArrayBuffer; mimeType: string; name: string }) {
      const parser = parsers.find((candidate) => candidate.supports(input.mimeType));
      if (!parser) throw new Error(`No parser configured for ${input.mimeType}`);
      return parser.extract(input);
    },
  };
}

export async function processDocumentJob(
  job: DocumentIndexJob,
  env: {
    FILES: R2Bucket;
    KNOWLEDGE_INDEX: VectorizeIndex;
    OPENAI_API_KEY: string;
    parsers?: DocumentParser[];
  },
) {
  const object = await env.FILES.get(job.key);
  if (!object) throw new Error(`File not found: ${job.key}`);

  const bytes = await object.arrayBuffer();
  const text = env.parsers?.length
    ? await createDocumentParserRegistry(env.parsers).extract({ bytes, mimeType: job.type, name: job.name })
    : await extractPlainText(object);

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
