import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1).max(10000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(100),
});

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY is not configured", { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return new Response("Invalid request", { status: 400 });

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o-mini"),
    system: "You are the helpful AI assistant inside a production AI workspace. Be accurate, concise, and practical.",
    messages: [...parsed.data.history, { role: "user", content: parsed.data.message }],
  });

  return result.toTextStreamResponse();
}
