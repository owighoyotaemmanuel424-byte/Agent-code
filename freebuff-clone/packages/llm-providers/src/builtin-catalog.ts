import catalogJson from "../config/models.json";
import { modelCatalogSchema } from "@freebuff/shared";
import type { ModelCatalog } from "@freebuff/shared";

/**
 * The checked-in catalog, validated at import time. Operators can pass any
 * catalog to `ModelRegistry.create` instead; nothing reads model ids from code.
 */
export const defaultModelCatalog: ModelCatalog = modelCatalogSchema.parse(catalogJson);
