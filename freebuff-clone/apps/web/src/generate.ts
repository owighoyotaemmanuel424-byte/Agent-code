import type { ChatModel, ChatRequest } from "@freebuff/llm-providers";
import { AppError } from "@freebuff/shared";
import type { AgentUsage } from "@freebuff/shared";
import { appSpecSchema } from "./spec";
import type { AppSpec } from "./spec";

export interface GenerateSpecOptions {
  readonly prompt: string;
  readonly model: ChatModel;
  readonly modelId: string;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface GeneratedSpec {
  readonly spec: AppSpec;
  readonly usage: AgentUsage;
  readonly attempts: number;
}

const SYSTEM_PROMPT = `You design small data-backed web apps. Reply with ONE JSON object and nothing else.
Shape:
{
  "name": string (1-60 chars),
  "tagline": string (1-160 chars),
  "theme": {"primary": "#rrggbb", "accent": "#rrggbb", "radius": 0-24, "dark": boolean},
  "entities": [
    {
      "name": lower_snake_case,
      "label": string,
      "fields": [
        {"name": lower_snake_case, "label": string, "type": "text"|"longtext"|"integer"|"boolean"|"date", "required": boolean}
      ]
    }
  ]
}
Rules: 1-4 entities, each with 1-10 fields. Never use the field names id, ownerId or createdAt.
Every entity is a list the signed-in user can create, view and delete. Choose realistic data for the request.`;

const extractJson = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
};

const addUsage = (total: AgentUsage, delta: AgentUsage): AgentUsage => ({
  inputTokens: total.inputTokens + delta.inputTokens,
  outputTokens: total.outputTokens + delta.outputTokens,
});

const streamText = async (
  model: ChatModel,
  request: ChatRequest,
): Promise<{ text: string; usage: AgentUsage }> => {
  let text = "";
  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  for await (const event of model.stream(request)) {
    if (event.type === "text.delta") {
      text += event.delta;
    } else if (event.type === "usage") {
      usage = event.usage;
    }
  }
  return { text, usage };
};

/**
 * One constrained model call (plus a single repair attempt) turns the prompt
 * into a validated spec. The model never writes files or code directly.
 */
export const generateAppSpec = async (
  options: GenerateSpecOptions,
): Promise<GeneratedSpec> => {
  if (options.prompt.trim().length < 3) {
    throw new AppError({
      code: "validation_failed",
      message: "Describe the app you want in a sentence or two",
    });
  }
  const maxOutputTokens = options.maxOutputTokens ?? 2500;
  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let feedback: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const messages: ChatRequest["messages"] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: options.prompt.trim() },
      ...(feedback === undefined
        ? []
        : [{ role: "user" as const, content: `Your previous reply was invalid: ${feedback}. Reply with corrected JSON only.` }]),
    ];
    const result = await streamText(options.model, {
      model: options.modelId,
      messages,
      tools: [],
      maxOutputTokens,
      temperature: 0.2,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (options.signal?.aborted === true) {
      throw new AppError({ code: "cancelled", message: "Generation cancelled" });
    }
    usage = addUsage(usage, result.usage);

    const candidate = extractJson(result.text);
    if (candidate === undefined) {
      feedback = "no JSON object was found";
      continue;
    }
    const parsed = appSpecSchema.safeParse(candidate);
    if (parsed.success) {
      return { spec: parsed.data, usage, attempts: attempt };
    }
    feedback = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`)
      .join("; ");
  }

  throw new AppError({
    code: "provider_error",
    message: `The model did not return a usable app specification: ${feedback ?? "unknown error"}`,
  });
};
