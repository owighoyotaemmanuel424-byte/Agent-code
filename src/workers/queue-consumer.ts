import { processDocument } from "./process-document";
import type { DocumentIndexJob } from "./document-indexer";
import { createDocumentParsers } from "@/lib/parsers/registry";

export interface QueueEnv {
  FILES: R2Bucket;
  KNOWLEDGE_INDEX: Parameters<typeof processDocument>[1]["KNOWLEDGE_INDEX"];
  OPENAI_API_KEY: string;
}

const parsers = createDocumentParsers();

export async function consumeDocuments(
  batch: MessageBatch<DocumentIndexJob>,
  env: QueueEnv,
) {
  for (const message of batch.messages) {
    try {
      await processDocument(message.body, { ...env, parsers });
      message.ack();
    } catch (error) {
      console.error("Document queue job failed", {
        documentId: message.body.documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}
