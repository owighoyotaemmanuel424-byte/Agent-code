export interface EmbeddingClient {
  embed(input: string[]): Promise<number[][]>;
}

export function createOpenAIEmbeddingClient(apiKey: string, model = "text-embedding-3-small"): EmbeddingClient {
  return {
    async embed(input) {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input }),
      });
      if (!response.ok) throw new Error(`Embedding request failed: ${response.status}`);
      const json = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
      return json.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    },
  };
}
