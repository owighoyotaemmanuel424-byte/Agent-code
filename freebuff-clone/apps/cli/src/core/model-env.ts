import { ModelRegistry, defaultModelCatalog } from "@freebuff/llm-providers";
import type { ProviderCredentials } from "@freebuff/llm-providers";
import { AppError } from "@freebuff/shared";
import type { ModelProvider, Plan } from "@freebuff/shared";

/**
 * Providers are enabled only when their key is present. Keys stay in the
 * environment; nothing is written to disk.
 */
export const createRegistryFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): ModelRegistry => {
  const providers: Partial<Record<ModelProvider, ProviderCredentials>> = {};
  if (env["DEEPSEEK_API_KEY"] !== undefined && env["DEEPSEEK_API_KEY"].length > 0) {
    providers.deepseek = { apiKey: env["DEEPSEEK_API_KEY"] };
  }
  if (env["OPENAI_API_KEY"] !== undefined && env["OPENAI_API_KEY"].length > 0) {
    providers.openai = { apiKey: env["OPENAI_API_KEY"] };
  }
  if (env["ANTHROPIC_API_KEY"] !== undefined && env["ANTHROPIC_API_KEY"].length > 0) {
    providers.anthropic = { apiKey: env["ANTHROPIC_API_KEY"] };
  }
  if (Object.keys(providers).length === 0) {
    throw new AppError({
      code: "validation_failed",
      message:
        "No model provider configured. Set DEEPSEEK_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY.",
    });
  }
  return ModelRegistry.create({ catalog: defaultModelCatalog, providers });
};

export const chooseDefaultModel = (
  registry: ModelRegistry,
  plan: Plan,
): string => {
  const first = registry.available(plan)[0];
  if (first === undefined) {
    throw new AppError({
      code: "not_found",
      message: `No model is available for the ${plan} plan`,
    });
  }
  return first.id;
};
