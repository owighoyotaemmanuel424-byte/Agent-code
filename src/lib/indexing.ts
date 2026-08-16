import { chunkText } from "@/lib/chunking";
import { createOpenAIEmbeddingClient } from "@/lib/embeddings";
import { indexChunks, type VectorizeIndex } from "@/lib/vectorize";
import { buildVectorMetadata } from "@/lib/knowledge-access";

export async function indexTextDocument(input: {
  index: VectorizeIndex;
  apiKey: string;
  documentId: string;
  workspaceId: string;
  ownerId: string;
  text: string;
}) {
  const chunks = chunkText(input.text);
  const embeddings = await createOpenAIEmbeddingClient(input.apiKey).embed(chunks);
  return indexChunks(input.index, chunks.map((text, i) => ({
    id: `${input.documentId}:${i}`,
    embedding: embeddings[i],
    metadata: buildVectorMetadata({
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      text,
      chunk: i,
    }),
  })));
}
