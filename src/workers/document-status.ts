import { prisma } from "@/lib/prisma";

export async function markIndexing(documentId: string) {
  return prisma.knowledgeDocument.updateMany({
    where: { id: documentId, status: "PENDING" },
    data: { status: "INDEXING", error: null },
  });
}

export async function markReady(documentId: string) {
  return prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: "READY", error: null },
  });
}

export async function markFailed(documentId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Document indexing failed";
  return prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: "FAILED", error: message.slice(0, 2000) },
  });
}
