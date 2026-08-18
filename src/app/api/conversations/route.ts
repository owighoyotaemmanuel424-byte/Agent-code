import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, model: true, pinned: true, updatedAt: true },
  });
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "New chat";
  const model = typeof body.model === "string" ? body.model : "gpt-4o-mini";
  const conversation = await prisma.conversation.create({
    data: { userId: user.id, title, model },
  });
  return NextResponse.json({ conversation }, { status: 201 });
}
