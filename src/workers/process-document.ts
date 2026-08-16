import { processDocumentJob, type DocumentIndexJob } from "./document-indexer";
import { markFailed, markIndexing, markReady } from "./document-status";

export async function processDocument(job: DocumentIndexJob, env: Parameters<typeof processDocumentJob>[1]) {
  const claimed = await markIndexing(job.documentId);
  if (claimed.count === 0) return { skipped: true };

  try {
    await processDocumentJob(job, env);
    await markReady(job.documentId);
    return { skipped: false, status: "READY" as const };
  } catch (error) {
    await markFailed(job.documentId, error);
    throw error;
  }
}
