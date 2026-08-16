export interface KnowledgeDocument {
  id: string;
  workspaceId: string;
  ownerId: string;
}

export function canAccessKnowledgeDocument(
  document: KnowledgeDocument,
  principal: { userId: string; workspaceIds: Set<string> },
) {
  return document.ownerId === principal.userId || principal.workspaceIds.has(document.workspaceId);
}

export function buildVectorMetadata(input: {
  documentId: string;
  workspaceId: string;
  ownerId: string;
  text: string;
  chunk: number;
}) {
  return {
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    text: input.text,
    chunk: input.chunk,
  };
}
