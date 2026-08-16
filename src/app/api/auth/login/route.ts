import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createSession, verifyPassword } from '@/lib/auth';

const schema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user?.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  await createSession(user.id);
  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}
