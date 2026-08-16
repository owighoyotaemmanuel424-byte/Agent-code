import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";
import { buildGroundedSystemPrompt } from "@/lib/rag/prompt";
import { buildKnowledgeContext } from "@/lib/knowledge-context";
import { getCloudflareBindings } from "@/lib/cloudflare-env";
import { requireUser, requireWorkspaceMember } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { enforceDailyUsage } from "@/lib/usage/enforce";
import { recordUsage } from "@/lib/usage/record";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1).max(10000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(30000) })).max(100),
  workspaceIds: z.array(z.string().min(1).max(100)).max(50).optional(),
  model: z.string().regex(/^[a-zA-Z0-9._:-]+$/).max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const bindings = getCloudflareBindings();

    if (bindings?.CHAT_RATE_LIMITER) {
      const decision = await bindings.CHAT_RATE_LIMITER.limit({ key: `user:${user.id}` });
      if (!decision.success) {
        return new Response("Too many chat requests", {
          status: 429,
          headers: { "Retry-After": "60", "Cache-Control": "no-store" },
        });
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      return new Response("OPENAI_API_KEY is not configured", { status: 503 });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return new Response("Invalid request", { status: 400 });

    const requestedWorkspaceIds = parsed.data.workspaceIds ?? [];
    for (const workspaceId of requestedWorkspaceIds) {
      await requireWorkspaceMember(workspaceId);
    }

    const estimatedTokens = Math.ceil((parsed.data.message.length + parsed.data.history.reduce((sum, item) => sum + item.content.length, 0)) / 4);
    const usage = await enforceDailyUsage(prisma, user.id, estimatedTokens);
    if (!usage.allowed) {
      return new Response("Usage limit exceeded", {
        status: 429,
        headers: { "Retry-After": "60", "Cache-Control": "no-store" },
      });
    }

    let knowledgeContext = "";
    if (bindings?.KNOWLEDGE_INDEX && requestedWorkspaceIds.length) {
      knowledgeContext = await buildKnowledgeContext({
        index: bindings.KNOWLEDGE_INDEX,
        apiKey: process.env.OPENAI_API_KEY,
        query: parsed.data.message,
        workspaceIds: requestedWorkspaceIds,
      });
    }

    const system = buildGroundedSystemPrompt(undefined, knowledgeContext
      ? [{ id: "knowledge", score: 1, text: knowledgeContext }]
      : []);

    const result = streamText({
      model: openai(parsed.data.model || process.env.OPENAI_MODEL || "gpt-4o-mini"),
      system,
      messages: [...parsed.data.history, { role: "user", content: parsed.data.message }],
      onFinish: async ({ usage }) => {
        await recordUsage(prisma, {
          userId: user.id,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return new Response("Unauthorized", { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return new Response("Forbidden", { status: 403 });
    }
    console.error("Chat request failed", error);
    return new Response("Internal server error", { status: 500 });
  }
}
