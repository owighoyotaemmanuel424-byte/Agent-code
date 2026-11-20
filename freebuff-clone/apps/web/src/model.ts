import { ModelRegistry, defaultModelCatalog } from "@freebuff/llm-providers";
import type {
  ChatModel,
  ProviderCredentials,
} from "@freebuff/llm-providers";
import type { ModelDescriptor, ModelProvider, Plan } from "@freebuff/shared";

export interface ResolvedModels {
  readonly registry: ModelRegistry;
  readonly defaultModelId: string;
}

export interface ResolvedModel {
  readonly model: ChatModel;
  readonly modelId: string;
}

/**
 * Providers are enabled only when their key is present. Nothing is written to
 * disk and no key ever reaches the browser.
 */
export const createModelFromEnv = (
  env: NodeJS.ProcessEnv,
): ResolvedModels | undefined => {
  const providers: Partial<Record<ModelProvider, ProviderCredentials>> = {};
  const keys: Record<ModelProvider, string | undefined> = {
    deepseek: env["DEEPSEEK_API_KEY"],
    openai: env["OPENAI_API_KEY"],
    anthropic: env["ANTHROPIC_API_KEY"],
  };
  for (const [provider, key] of Object.entries(keys) as [
    ModelProvider,
    string | undefined,
  ][]) {
    if (key !== undefined && key.length > 0) {
      providers[provider] = { apiKey: key };
    }
  }
  if (Object.keys(providers).length === 0) {
    return undefined;
  }
  const registry = ModelRegistry.create({ catalog: defaultModelCatalog, providers });
  const descriptor = selectModelForPlan(registry.list(), "free");
  if (descriptor === undefined) {
    return undefined;
  }
  return { registry, defaultModelId: descriptor.id };
};

/**
 * Picks the best model a plan can use. Paid plans prefer premium-only models;
 * free plans take the first available entry. The catalog decides, not the
 * caller, so a plan cannot be tricked into a premium model by a model id.
 */
export const selectModelForPlan = (
  models: readonly ModelDescriptor[],
  plan: Plan,
): ModelDescriptor | undefined => {
  const available = models.filter((model) => model.planTiers.includes(plan));
  if (available.length === 0) {
    return undefined;
  }
  if (plan === "paid") {
    const premium = available.find((model) => !model.planTiers.includes("free"));
    if (premium !== undefined) {
      return premium;
    }
  }
  return available[0];
};

export const modelForPlan = (
  resolved: ResolvedModels,
  plan: Plan,
): ResolvedModel | undefined => {
  const descriptor = selectModelForPlan(resolved.registry.list(), plan);
  if (descriptor === undefined) {
    return undefined;
  }
  return { model: resolved.registry.get(descriptor.id), modelId: descriptor.id };
};

/** The model the builder page advertises: the free-tier default. */
export const defaultModelIdOf = (resolved: ResolvedModels): string =>
  resolved.defaultModelId;
