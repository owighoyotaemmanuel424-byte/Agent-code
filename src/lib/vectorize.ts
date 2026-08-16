export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorizeIndex {
  upsert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>): Promise<unknown>;
  query(values: number[], options?: { topK?: number; returnMetadata?: boolean }): Promise<{ matches: VectorizeMatch[] }>;
}

export async function indexChunks(index: VectorizeIndex, chunks: Array<{ id: string; embedding: number[]; metadata?: Record<string, unknown> }>) {
  return index.upsert(chunks.map(({ id, embedding, metadata }) => ({ id, values: embedding, metadata })));
}

export async function searchKnowledge(index: VectorizeIndex, embedding: number[], topK = 8) {
  return index.query(embedding, { topK, returnMetadata: true });
}
