import type { AgentRunOutcome } from "@freebuff/agent-runtime";
import {
  FileSystemWorkspace,
  ProcessCommandRunner,
  RipgrepSearchRunner,
  ToolRegistry,
  createDefaultTools,
  runAgent,
} from "@freebuff/agent-runtime";
import { RepositoryCodeMap } from "@freebuff/code-map";
import type { ChatModel } from "@freebuff/llm-providers";
import { formatSponsoredAd, selectSponsoredAd } from "@freebuff/ads";
import type { AdDecision, AdInventory } from "@freebuff/ads";
import {
  AppError,
  QuotaExceededError,
  VerificationRequiredError,
  agentIdSchema,
  newId,
  nowIso,
  runIdSchema,
  sessionIdSchema,
} from "@freebuff/shared";
import type {
  AgentEvent,
  AgentLimits,
  AgentMessage,
  Plan,
  SessionId,
  Surface,
} from "@freebuff/shared";
import type { ProjectEntry } from "./config";
import type { StoredCredentials } from "./credentials";
import type { ChatHistoryStore } from "./history";
import type { PlatformClient } from "./platform";

export interface ModelHandle {
  readonly model: ChatModel;
  readonly maxOutputTokens: number;
}

export interface ChatTurnDependencies {
  readonly platform: PlatformClient;
  readonly history: ChatHistoryStore;
  readonly inventory: AdInventory;
  readonly countryCode: string;
  readonly resolveModel: (modelId: string) => ModelHandle;
  /** Server-side model entitlement check; a plan never widens by prompt. */
  readonly isModelAllowed?: (modelId: string, plan: Plan) => boolean;
  readonly limits?: AgentLimits;
  /** Called once, before the run starts, when a sponsored slot is served. */
  readonly onAd?: (decision: AdDecision) => void;
}

export interface ChatTurnInput {
  readonly credentials: StoredCredentials;
  readonly project: ProjectEntry;
  readonly prompt: string;
  readonly modelId: string;
  readonly sessionId?: SessionId;
  readonly signal: AbortSignal;
  readonly emit: (event: AgentEvent) => void;
  readonly surface?: Surface;
  readonly useCodeMap?: boolean;
}

export interface ChatTurnResult {
  readonly sessionId: SessionId;
  readonly outcome: AgentRunOutcome;
  readonly ad: AdDecision | undefined;
}

const DEFAULT_LIMITS: AgentLimits = {
  maxSteps: 24,
  maxTokens: 250_000,
  maxWallClockMs: 15 * 60 * 1000,
  maxParallelSubagents: 4,
};

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your",
  "please", "make", "when", "then", "have", "will", "should", "could",
  "would", "there", "their", "about", "using", "need", "some",
]);

/**
 * Local topic extraction for contextual ad targeting. Runs entirely on this
 * machine: no prompt text leaves the process. Embedding-based targeting lands
 * with the ad engine in Phase 5 behind the same selection contract.
 */
export const extractTopics = (prompt: string): string[] =>
  prompt
    .toLowerCase()
    .split(/[^a-z0-9+#-]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .slice(0, 8);

const systemPrompt = (project: ProjectEntry): string =>
  [
    "You are freebuff, a coding agent working inside a user's repository.",
    `Project: ${project.name} at the workspace root.`,
    "Use tools to inspect and change files. Prefer edit_file or patch_files over rewriting whole files.",
    "Run tests or commands when they help verify the change.",
    "Finish with a short summary of what changed and any remaining risk.",
    "Never print secrets, tokens or credentials.",
  ].join("\n");

const quotaDeniedError = (
  reason: "quota_exhausted" | "phone_verification_required" | "account_suspended",
  resetsAt: string,
): AppError => {
  switch (reason) {
    case "phone_verification_required":
      return new VerificationRequiredError(
        "Verify your phone number to keep using the free tier",
      );
    case "quota_exhausted":
      return new QuotaExceededError(
        `Hour quota exhausted for today. It resets at ${resetsAt}`,
      );
    case "account_suspended":
      return new AppError({
        code: "forbidden",
        message: "This account is suspended",
      });
  }
};

/**
 * One chat turn: verify the session, gate on server-authoritative quota, serve
 * the sponsored slot, run the agent and persist everything the model saw.
 */
export const runChatTurn = async (
  dependencies: ChatTurnDependencies,
  input: ChatTurnInput,
): Promise<ChatTurnResult> => {
  const user = await dependencies.platform.verifySession(input.credentials.token);

  if (
    dependencies.isModelAllowed !== undefined &&
    !dependencies.isModelAllowed(input.modelId, user.plan)
  ) {
    throw new AppError({
      code: "forbidden",
      message: `Model "${input.modelId}" is not available on the ${user.plan} plan`,
    });
  }

  const quota = await dependencies.platform.beginHour({
    userId: user.id,
    plan: user.plan,
    countryCode: user.plan === "free" ? dependencies.countryCode : "US",
    phoneVerified: user.phoneVerified,
  });
  if (!quota.decision.allowed) {
    throw quotaDeniedError(quota.decision.reason, quota.snapshot.resetsAt);
  }

  const existing =
    input.sessionId === undefined
      ? undefined
      : await dependencies.history.load(input.sessionId);
  const session =
    existing ??
    (await dependencies.history.create({
      projectId: input.project.id,
      title: input.prompt.slice(0, 80),
      modelId: input.modelId,
    }));

  const ad = selectSponsoredAd(
    {
      slot: "cli.session",
      plan: user.plan,
      topics: extractTopics(input.prompt),
      seed: String(session.meta.id),
    },
    dependencies.inventory,
  );
  if (ad !== undefined) {
    dependencies.onAd?.(ad);
  }

  const userMessage: AgentMessage = {
    id: newId(),
    role: "user",
    content: input.prompt,
    createdAt: nowIso(),
  };
  await dependencies.history.append(session.meta.id, [userMessage]);

  const workspace = new FileSystemWorkspace(input.project.path);
  const registry = new ToolRegistry();
  for (const tool of createDefaultTools()) {
    registry.register(tool);
  }

  const codeMap =
    input.useCodeMap === true
      ? await RepositoryCodeMap.load(input.project.path, { maxFiles: 2000 })
      : undefined;

  const handle = dependencies.resolveModel(input.modelId);
  const messages = [...session.messages, userMessage];

  const outcome = await runAgent({
    model: handle.model,
    modelId: input.modelId,
    maxOutputTokens: handle.maxOutputTokens,
    runId: runIdSchema.parse(newId()),
    sessionId: sessionIdSchema.parse(String(session.meta.id)),
    agentId: agentIdSchema.parse(newId()),
    surface: input.surface ?? "cli",
    systemPrompt: systemPrompt(input.project),
    messages,
    limits: dependencies.limits ?? DEFAULT_LIMITS,
    registry,
    context: {
      workspace,
      signal: input.signal,
      search: new RipgrepSearchRunner(input.project.path),
      terminal: new ProcessCommandRunner(input.project.path),
      ...(codeMap === undefined ? {} : { codeMap }),
    },
    emit: input.emit,
    signal: input.signal,
  });

  const produced = outcome.messages.slice(messages.length);
  if (produced.length > 0) {
    await dependencies.history.append(session.meta.id, produced);
  }

  return { sessionId: session.meta.id, outcome, ad };
};

export const renderAdLines = (decision: AdDecision): readonly string[] =>
  formatSponsoredAd(decision.ad);
