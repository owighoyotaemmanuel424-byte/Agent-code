import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AppError,
  adSchema,
  agentEventSchema,
  countryQuotaConfigSchema,
  defineTool,
  err,
  isModelAvailable,
  modelDescriptorSchema,
  newId,
  ok,
  quotaConfigSchema,
  quotaDecisionSchema,
  sessionSchema,
  timestampSchema,
  toErrorPayload,
  toolNameSchema,
  toolResultSchema,
} from "@freebuff/shared";

const ad = {
  id: newId(),
  advertiser: "Acme Observability",
  headline: "Trace your agents in production",
  body: "Spans, cost and latency per run. Free for the first 100k spans.",
  destinationUrl: "https://example.com/traces",
  label: "Sponsored" as const,
  topics: ["observability", "agents"],
  slots: ["cli.session" as const],
  status: "active" as const,
  weight: 10,
};

describe("ads", () => {
  it("accepts a labelled HTTPS sponsored ad", () => {
    expect(adSchema.parse(ad).label).toBe("Sponsored");
  });

  it("rejects non-HTTPS destinations", () => {
    expect(() =>
      adSchema.parse({ ...ad, destinationUrl: "http://example.com" }),
    ).toThrow();
  });

  it("rejects a missing or altered sponsored label", () => {
    const { label: _label, ...unlabelled } = ad;
    expect(() => adSchema.parse(unlabelled)).toThrow();
  });
});

describe("tools", () => {
  it("accepts snake_case tool names and rejects others", () => {
    expect(toolNameSchema.parse("read_file")).toBe("read_file");
    expect(() => toolNameSchema.parse("Read-File")).toThrow();
    expect(() => toolNameSchema.parse("1read")).toThrow();
  });

  it("validates a successful tool result", () => {
    const parsed = toolResultSchema.parse({
      status: "ok",
      callId: newId(),
      output: { files: 2 },
      durationMs: 12,
    });
    expect(parsed.status).toBe("ok");
  });

  it("carries a typed failure for a failed tool call", () => {
    const parsed = toolResultSchema.parse({
      status: "error",
      callId: newId(),
      error: { code: "timeout", message: "Command exceeded 30s", retryable: true },
      durationMs: 30001,
    });
    expect(parsed.status).toBe("error");
  });

  it("keeps parameter schemas attached to definitions", () => {
    const tool = defineTool({
      name: "read_file",
      kind: "files.read",
      description: "Read a UTF-8 file inside the workspace",
      parameters: z.object({ path: z.string().min(1) }),
      mutating: false,
      timeoutMs: 5000,
    });
    expect(tool.parameters.safeParse({ path: "src/index.ts" }).success).toBe(true);
  });
});

describe("agent events", () => {
  it("validates a streamed message delta", () => {
    const event = agentEventSchema.parse({
      type: "message.delta",
      runId: newId(),
      messageId: newId(),
      delta: "Patching ",
    });
    expect(event.type).toBe("message.delta");
  });

  it("validates run completion with usage", () => {
    const event = agentEventSchema.parse({
      type: "run.completed",
      runId: newId(),
      status: "completed",
      usage: { inputTokens: 1200, outputTokens: 340 },
      finishedAt: new Date().toISOString(),
    });
    expect(event.type).toBe("run.completed");
  });

  it("rejects unknown event types", () => {
    expect(() =>
      agentEventSchema.parse({ type: "run.exploded", runId: newId() }),
    ).toThrow();
  });
});

describe("quota", () => {
  const config = {
    countryCode: "US",
    timeZone: "America/New_York",
    freeHoursPerDay: 30,
    paidHoursPerDay: 24,
    updatedAt: new Date().toISOString(),
  };

  it("rejects a paid allowance below the free allowance", () => {
    expect(() => countryQuotaConfigSchema.parse(config)).toThrow();
  });

  it("rejects a non alpha-2 country code", () => {
    expect(() =>
      countryQuotaConfigSchema.parse({ ...config, countryCode: "USA", paidHoursPerDay: 30 }),
    ).toThrow();
  });

  it("parses a config file with a default and country overrides", () => {
    const parsed = quotaConfigSchema.parse({
      version: 1,
      default: { timeZone: "UTC", freeHoursPerDay: 5, paidHoursPerDay: 5 },
      countries: [
        {
          countryCode: "US",
          timeZone: "America/New_York",
          freeHoursPerDay: 30,
          paidHoursPerDay: 30,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    expect(parsed.default.freeHoursPerDay).toBe(5);
  });

  it("represents an exhausted free tier as a denial, not an error", () => {
    const decision = quotaDecisionSchema.parse({
      allowed: false,
      reason: "quota_exhausted",
      snapshot: {
        userId: newId(),
        plan: "free",
        countryCode: "US",
        timeZone: "America/New_York",
        hoursPerDay: 30,
        consumedSecondsToday: 108000,
        resetsAt: new Date().toISOString(),
        phoneVerified: true,
        adsEnabled: true,
      },
    });
    expect(decision.allowed).toBe(false);
  });
});

describe("models", () => {
  const descriptor = modelDescriptorSchema.parse({
    id: "premium-model-placeholder",
    provider: "anthropic",
    displayName: "Premium",
    contextWindow: 200000,
    maxOutputTokens: 32000,
    planTiers: ["paid"],
  });

  it("gates premium models behind the paid tier", () => {
    expect(isModelAvailable(descriptor, "paid")).toBe(true);
    expect(isModelAvailable(descriptor, "free")).toBe(false);
  });
});

describe("sessions", () => {
  it("parses a session with history", () => {
    const parsed = sessionSchema.parse({
      id: newId(),
      userId: newId(),
      surface: "cli",
      title: "Fix the failing test",
      modelId: "configured-model-a",
      messages: [
        {
          id: newId(),
          role: "user",
          content: "Fix the failing test",
          createdAt: new Date().toISOString(),
        },
      ],
      status: "active",
      usageSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.messages).toHaveLength(1);
  });

  it("rejects an unknown surface", () => {
    expect(() =>
      sessionSchema.parse({
        id: newId(),
        userId: newId(),
        surface: "terminal",
        title: "x",
        modelId: "m",
        messages: [],
        status: "active",
        usageSeconds: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe("errors and results", () => {
  it("serializes an AppError without leaking details", () => {
    const payload = toErrorPayload(
      new AppError({
        code: "provider_rate_limited",
        message: "Upstream provider asked us to slow down",
        retryable: true,
        details: { token: "must-not-ship" },
      }),
    );
    expect(payload).toEqual({
      code: "provider_rate_limited",
      message: "Upstream provider asked us to slow down",
      retryable: true,
    });
  });

  it("serializes unknown throws as internal errors", () => {
    expect(toErrorPayload(new Error("boom"))).toEqual({
      code: "internal",
      message: "boom",
      retryable: false,
    });
  });

  it("narrows ok and err results", () => {
    const success = ok("value");
    const failure = err({ reason: "denied" });
    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
  });

  it("validates timestamps", () => {
    expect(timestampSchema.safeParse("not-a-date").success).toBe(false);
    expect(timestampSchema.safeParse(new Date(0).toISOString()).success).toBe(true);
  });
});
