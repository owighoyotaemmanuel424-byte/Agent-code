import { retrieveKnowledge, formatRetrievedContext } from "@/lib/rag";
import type { VectorizeIndex } from "@/lib/vectorize";

export async function buildKnowledgeContext(input: {
  index: VectorizeIndex;
  apiKey: string;
  query: string;
  workspaceIds: string[];
  topK?: number;
}) {
  const result = await retrieveKnowledge(input.index, input.apiKey, input.query, input.topK ?? 8);
  const allowed = result.matches.filter((match) => {
    const workspaceId = String(match.metadata?.workspaceId ?? "");
    return input.workspaceIds.includes(workspaceId);
  });
  return formatRetrievedContext(allowed);
}
