import { NextResponse } from "next/server";
import { getCloudflareBindings } from "@/lib/cloudflare-env";
import { PrismaClient } from "@prisma/client";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "application/zip",
]);

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const bindings = getCloudflareBindings();
  if (!bindings?.FILES || !bindings.DOCUMENT_QUEUE) {
    return NextResponse.json({ error: "Object storage is not configured" }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const workspaceId = String(form.get("workspaceId") ?? "");
  const ownerId = String(form.get("ownerId") ?? "");

  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (!workspaceId || !ownerId) return NextResponse.json({ error: "workspaceId and ownerId are required" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File exceeds the 25 MB limit" }, { status: 413 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });

  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: ownerId } } });
  if (!member) return NextResponse.json({ error: "Not authorized for workspace" }, { status: 403 });

  const documentId = crypto.randomUUID();
  const key = `uploads/${workspaceId}/${documentId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  await bindings.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const document = await prisma.knowledgeDocument.create({
    data: { id: documentId, workspaceId, ownerId, name: file.name, objectKey: key, mimeType: file.type, size: BigInt(file.size) },
  });

  await bindings.DOCUMENT_QUEUE.send({ key, name: file.name, type: file.type, documentId, workspaceId, ownerId });

  return NextResponse.json({ id: document.id, key, name: document.name, size: file.size, type: file.type, status: document.status }, { status: 201 });
}
