import {
  AppError,
  CircuitBreaker,
  isModelAvailable,
  modelCatalogSchema,
} from "@freebuff/shared";
import type {
  ModelCatalog,
  ModelDescriptor,
  ModelProvider,
  Plan,
} from "@freebuff/shared";
import { AnthropicModel } from "./anthropic";
import type { ProviderHttpOptions } from "./http";
import { OpenAiCompatibleModel } from "./openai-compatible";
import type { ChatModel } from "./types";

export interface ProviderCredentials {
  readonly apiKey: string;
  /** Overrides the provider default. Set per environment, never per model. */
  readonly baseUrl?: string;
}

export interface ModelRegistryConfig {
  readonly catalog: ModelCatalog;
  readonly providers: Partial<Record<ModelProvider, ProviderCredentials>>;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URLS: Record<ModelProvider, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  anthropic: "https://api.anthropic.com/v1",
};

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Resolves model ids from the catalog into streamable providers. Selecting a
 * model is a lookup, never a branch on a model name.
 */
export class ModelRegistry {
  private readonly models: Map<string, ChatModel>;
  private readonly descriptors: Map<string, ModelDescriptor>;

  private constructor(
    models: Map<string, ChatModel>,
    descriptors: Map<string, ModelDescriptor>,
  ) {
    this.models = models;
    this.descriptors = descriptors;
  }

  static create(config: ModelRegistryConfig): ModelRegistry {
    const catalog = modelCatalogSchema.parse(config.catalog);
    const models = new Map<string, ChatModel>();
    const descriptors = new Map<string, ModelDescriptor>();
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (const descriptor of catalog.models) {
      const credentials = config.providers[descriptor.provider];
      // Models from an unconfigured provider are simply unavailable; a surface
      // only needs credentials for the providers it actually offers.
      if (credentials === undefined) {
        continue;
      }
      const http: ProviderHttpOptions = {
        apiKey: credentials.apiKey,
        baseUrl: credentials.baseUrl ?? DEFAULT_BASE_URLS[descriptor.provider],
        timeoutMs,
        breaker: new CircuitBreaker({
          failureThreshold: 5,
          cooldownMs: 30_000,
        }),
        ...(config.fetchImpl === undefined ? {} : { fetchImpl: config.fetchImpl }),
      };

      const model: ChatModel =
        descriptor.provider === "anthropic"
          ? new AnthropicModel({ http, id: descriptor.id })
          : new OpenAiCompatibleModel({
              http,
              provider: descriptor.provider,
              id: descriptor.id,
            });

      models.set(descriptor.id, model);
      descriptors.set(descriptor.id, descriptor);
    }

    if (models.size === 0) {
      throw new AppError({
        code: "validation_failed",
        message: "No model providers are configured",
      });
    }
    return new ModelRegistry(models, descriptors);
  }

  get(modelId: string): ChatModel {
    const model = this.models.get(modelId);
    if (model === undefined) {
      throw new AppError({
        code: "not_found",
        message: `Model "${modelId}" is not in the configured catalog`,
      });
    }
    return model;
  }

  descriptor(modelId: string): ModelDescriptor {
    const descriptor = this.descriptors.get(modelId);
    if (descriptor === undefined) {
      throw new AppError({
        code: "not_found",
        message: `Model "${modelId}" is not in the configured catalog`,
      });
    }
    return descriptor;
  }

  list(): ModelDescriptor[] {
    return [...this.descriptors.values()];
  }

  available(plan: Plan): ModelDescriptor[] {
    return this.list().filter((descriptor) => isModelAvailable(descriptor, plan));
  }

  isAllowed(modelId: string, plan: Plan): boolean {
    return isModelAvailable(this.descriptor(modelId), plan);
  }
}
