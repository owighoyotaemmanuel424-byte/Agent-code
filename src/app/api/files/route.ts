import { NextResponse } from "next/server";
import { getCloudflareBindings } from "@/lib/cloudflare-env";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png", "image/jpeg", "application/zip",
]);

export async function POST(request: Request) {
  const bindings = getCloudflareBindings();
  if (!bindings?.FILES || !bindings.DOCUMENT_QUEUE) return NextResponse.json({ error: "Object storage is not configured" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const workspaceId = String(form.get("workspaceId") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File exceeds the 25 MB limit" }, { status: 413 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });

  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
  if (!member) return NextResponse.json({ error: "Not authorized for workspace" }, { status: 403 });

  const documentId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `uploads/${workspaceId}/${documentId}/${safeName}`;
  await bindings.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  try {
    const document = await prisma.knowledgeDocument.create({
      data: { id: documentId, workspaceId, ownerId: user.id, name: file.name, objectKey: key, mimeType: file.type, size: BigInt(file.size) },
    });
    await bindings.DOCUMENT_QUEUE.send({ key, name: file.name, type: file.type, documentId, workspaceId, ownerId: user.id });
    return NextResponse.json({ id: document.id, key, name: document.name, size: file.size, type: file.type, status: document.status }, { status: 201 });
  } catch (error) {
    await bindings.FILES.delete(key);
    console.error("Failed to persist uploaded document", error);
    return NextResponse.json({ error: "Failed to persist document" }, { status: 500 });
  }
}
