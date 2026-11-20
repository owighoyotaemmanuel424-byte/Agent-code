import { z } from "zod";
import { planSchema } from "./plans";
import type { Plan } from "./plans";

/**
 * Provider and model selection is configuration driven. Nothing in the runtime
 * hardcodes a model name: budgets and tier access come from this catalog.
 */
export const modelProviderSchema = z.enum(["deepseek", "openai", "anthropic"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const modelDescriptorSchema = z.object({
  id: z.string().min(1).max(120),
  provider: modelProviderSchema,
  displayName: z.string().min(1).max(80),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  planTiers: z.array(planSchema).min(1),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

export const modelCatalogSchema = z.object({
  version: z.literal(1),
  models: z.array(modelDescriptorSchema).min(1),
});
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

export const isModelAvailable = (
  descriptor: ModelDescriptor,
  plan: Plan,
): boolean => descriptor.planTiers.includes(plan);

export const findModel = (
  catalog: ModelCatalog,
  modelId: string,
): ModelDescriptor | undefined =>
  catalog.models.find((model) => model.id === modelId);
