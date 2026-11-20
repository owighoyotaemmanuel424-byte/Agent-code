import { describe, expect, it } from "vitest";
import { modelDescriptorSchema } from "@freebuff/shared";
import { selectModelForPlan } from "../../../apps/web/src/model";

const model = (
  id: string,
  planTiers: readonly ("free" | "paid")[],
  provider: "openai" | "anthropic" | "deepseek" = "openai",
) =>
  modelDescriptorSchema.parse({
    id,
    provider,
    displayName: id,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    planTiers,
  });

const catalog = [
  model("shared-model", ["free", "paid"]),
  model("premium-model", ["paid"], "anthropic"),
];

describe("model selection by plan", () => {
  it("gives free plans the first model they are allowed to use", () => {
    expect(selectModelForPlan(catalog, "free")?.id).toBe("shared-model");
  });

  it("prefers premium-only models on the paid tier", () => {
    expect(selectModelForPlan(catalog, "paid")?.id).toBe("premium-model");
  });

  it("falls back to a shared model when no premium model exists", () => {
    expect(selectModelForPlan([model("shared-model", ["free", "paid"])], "paid")?.id).toBe(
      "shared-model",
    );
  });

  it("never returns a model above the caller's plan", () => {
    expect(selectModelForPlan([model("premium-model", ["paid"])], "free")).toBeUndefined();
  });
});
