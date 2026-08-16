import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";
import { buildKnowledgeContext } from "@/lib/knowledge-context";
import { getCloudflareBindings } from "@/lib/cloudflare-env";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1).max(10000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(100),
  workspaceIds: z.array(z.string()).max(50).optional(),
});

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY is not configured", { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return new Response("Invalid request", { status: 400 });

  const bindings = getCloudflareBindings();
  let knowledgeContext = "";
  if (bindings?.KNOWLEDGE_INDEX && parsed.data.workspaceIds?.length) {
    knowledgeContext = await buildKnowledgeContext({
      index: bindings.KNOWLEDGE_INDEX,
      apiKey: process.env.OPENAI_API_KEY,
      query: parsed.data.message,
      workspaceIds: parsed.data.workspaceIds,
    });
  }

  const system = knowledgeContext
    ? `You are the helpful AI assistant inside a production AI workspace. Be accurate, concise, and practical. Use the following authorized workspace knowledge when relevant. Do not claim knowledge that is not supported by the context.\n\n${knowledgeContext}`
    : "You are the helpful AI assistant inside a production AI workspace. Be accurate, concise, and practical.";

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o-mini"),
    system,
    messages: [...parsed.data.history, { role: "user", content: parsed.data.message }],
  });

  return result.toTextStreamResponse();
}
