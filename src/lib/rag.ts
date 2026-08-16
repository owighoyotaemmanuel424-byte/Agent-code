import { createOpenAIEmbeddingClient } from "@/lib/embeddings";
import { searchKnowledge, type VectorizeIndex } from "@/lib/vectorize";

export async function retrieveKnowledge(
  index: VectorizeIndex,
  apiKey: string,
  query: string,
  topK = 8,
) {
  const client = createOpenAIEmbeddingClient(apiKey);
  const [embedding] = await client.embed([query]);
  return searchKnowledge(index, embedding, topK);
}

export function formatRetrievedContext(matches: Array<{ score: number; metadata?: Record<string, unknown> }>) {
  return matches
    .filter((match) => match.score > 0.2)
    .map((match, i) => `[Source ${i + 1}] ${String(match.metadata?.text ?? "")}`)
    .filter(Boolean)
    .join("\n\n");
}
