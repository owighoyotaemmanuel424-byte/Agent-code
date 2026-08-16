export interface DocumentJob {
  key: string;
  name: string;
  type: string;
}

export async function handleDocumentQueue(
  batch: MessageBatch<DocumentJob>,
  env: { FILES: R2Bucket },
) {
  for (const message of batch.messages) {
    try {
      const object = await env.FILES.get(message.body.key);
      if (!object) throw new Error(`Object not found: ${message.body.key}`);

      // Parsing, chunking and embedding are intentionally delegated to the
      // document-processing pipeline. This worker is the durable queue boundary.
      console.log(JSON.stringify({ event: "document.received", ...message.body }));
      message.ack();
    } catch (error) {
      console.error("Document processing failed", error);
      message.retry();
    }
  }
}
