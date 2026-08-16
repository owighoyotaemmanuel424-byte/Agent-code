export interface RetrievalMatch {
  id: string;
  score: number;
  text: string;
  documentId?: string;
  metadata?: Record<string, unknown>;
}

interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
}

interface VectorIndex {
  query(vector: number[], options?: { topK?: number; returnMetadata?: boolean }): Promise<{
    matches?: Array<{
      id: string;
      score?: number;
      metadata?: Record<string, unknown>;
    }>;
  }>;
}

export async function retrieveContext(input: {
  query: string;
  workspaceId: string;
  embeddings: EmbeddingClient;
  index: VectorIndex;
  topK?: number;
  minScore?: number;
}) {
  const topK = Math.min(Math.max(input.topK ?? 6, 1), 20);
  const minScore = input.minScore ?? 0.72;
  const vector = await input.embeddings.embed(input.query);
  const result = await input.index.query(vector, { topK, returnMetadata: true });

  return (result.matches ?? [])
    .filter((match) => (match.score ?? 0) >= minScore)
    .filter((match) => match.metadata?.workspaceId === input.workspaceId)
    .map<RetrievalMatch>((match) => ({
      id: match.id,
      score: match.score ?? 0,
      text: String(match.metadata?.text ?? ""),
      documentId: typeof match.metadata?.documentId === "string" ? match.metadata.documentId : undefined,
      metadata: match.metadata,
    }))
    .filter((match) => match.text.trim().length > 0);
}

export function formatRetrievedContext(matches: RetrievalMatch[]) {
  return matches.map((match, index) =>
    `[Source ${index + 1}${match.documentId ? ` — ${match.documentId}` : ""}]\n${match.text}`,
  ).join("\n\n");
}
