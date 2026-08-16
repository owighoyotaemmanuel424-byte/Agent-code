import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createSession, hashPassword } from '@/lib/auth';

const schema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid registration data' }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: 'Unable to create account' }, { status: 409 });
  const user = await prisma.user.create({
    data: { email, name: parsed.data.name, passwordHash: hashPassword(parsed.data.password) },
    select: { id: true, email: true, name: true, role: true },
  });
  await createSession(user.id);
  return NextResponse.json({ user }, { status: 201 });
}
