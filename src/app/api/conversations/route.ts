import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

function userIdFromRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token ? verifySessionToken(token) : null;
}

export async function GET(request: Request) {
  const userId = userIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const conversations = await prisma.conversation.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, model: true, pinned: true, updatedAt: true },
  });
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  const userId = userIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "New chat";
  const model = typeof body.model === "string" ? body.model : "gpt-4o-mini";
  const conversation = await prisma.conversation.create({ data: { userId, title, model } });
  return NextResponse.json({ conversation }, { status: 201 });
}
