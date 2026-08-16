import { NextResponse } from "next/server";
import { getCloudflareBindings } from "@/lib/cloudflare-env";

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

export async function POST(request: Request) {
  const bindings = getCloudflareBindings();
  if (!bindings?.FILES) {
    return NextResponse.json({ error: "Object storage is not configured" }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit" }, { status: 413 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  }

  const id = crypto.randomUUID();
  const key = `uploads/${id}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await bindings.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  await bindings.DOCUMENT_QUEUE.send({ key, name: file.name, type: file.type });

  return NextResponse.json({ id, key, name: file.name, size: file.size, type: file.type }, { status: 201 });
}
