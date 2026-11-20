import { describe, expect, it } from "vitest";
import {
  FileSystemWorkspace,
  ProcessCommandRunner,
  ToolRegistry,
  createDefaultTools,
  runAgent,
} from "@freebuff/agent-runtime";
import { runParallelSubagents } from "@freebuff/agent-runtime";
import { AppError, agentIdSchema, newId, nowIso, runIdSchema, sessionIdSchema } from "@freebuff/shared";
import type { AgentEvent } from "@freebuff/shared";
import { createFixtureRepo } from "../../support/fixture-repo";
import { ScriptedModel } from "../../support/scripted-model";
import type { ScriptedTurn } from "../../support/scripted-model";

const baseOptions = (root: string, turns: readonly ScriptedTurn[], overrides: {
  readonly limits?: Parameters<typeof runAgent>[0]["limits"];
  readonly onEvent?: (event: AgentEvent) => void;
  readonly controller?: AbortController;
} = {}) => {
  const controller = overrides.controller ?? new AbortController();
  const workspace = new FileSystemWorkspace(root);
  const registry = new ToolRegistry();
  for (const tool of createDefaultTools()) {
    registry.register(tool);
  }
  const model = new ScriptedModel(turns);
  const events: AgentEvent[] = [];
  const options = {
    model,
    modelId: "scripted-model",
    maxOutputTokens: 2048,
    runId: runIdSchema.parse(newId()),
    sessionId: sessionIdSchema.parse(newId()),
    agentId: agentIdSchema.parse(newId()),
    surface: "cli" as const,
    systemPrompt: "test",
    messages: [
      { id: newId(), role: "user" as const, content: "go", createdAt: nowIso() },
    ],
    limits: overrides.limits ?? {
      maxSteps: 8,
      maxTokens: 100_000,
      maxWallClockMs: 30_000,
      maxParallelSubagents: 4,
    },
    registry,
    context: {
      workspace,
      signal: controller.signal,
      terminal: new ProcessCommandRunner(root),
    },
    emit: (event: AgentEvent) => {
      events.push(event);
      overrides.onEvent?.(event);
    },
    signal: controller.signal,
  };
  return { options, events, model, controller };
};

describe("agent loop", () => {
  it("streams deltas and aggregates usage", async () => {
    const repo = await createFixtureRepo({});
    try {
      const { options, events } = baseOptions(repo.root, [
        { text: "All done, nothing to change." },
      ]);
      const outcome = await runAgent(options);

      const deltas = events.filter((event) => event.type === "message.delta");
      expect(deltas.length).toBeGreaterThan(1);
      expect(
        deltas
          .map((event) => (event.type === "message.delta" ? event.delta : ""))
          .join(""),
      ).toBe("All done, nothing to change.");

      expect(outcome.status).toBe("completed");
      expect(outcome.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
      expect(events.filter((event) => event.type === "run.completed")).toHaveLength(1);
    } finally {
      await repo.cleanup();
    }
  });

  it("retries a retryable provider failure before any output", async () => {
    const repo = await createFixtureRepo({});
    try {
      const { options, model, events } = baseOptions(repo.root, [
        {
          failWith: new AppError({
            code: "provider_rate_limited",
            message: "slow down",
            retryable: true,
          }),
        },
        { text: "Recovered." },
      ]);
      const outcome = await runAgent({ ...options, retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 } });

      expect(outcome.status).toBe("completed");
      expect(model.requests).toHaveLength(2);
      expect(events.some((event) => event.type === "message.delta")).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });

  it("cancels cleanly and reports the cancelled status once", async () => {
    const repo = await createFixtureRepo({ "a.txt": "content\n" });
    try {
      const controller = new AbortController();
      const { options, events } = baseOptions(
        repo.root,
        [
          {
            toolCalls: [{ name: "read_file", arguments: { path: "a.txt" } }],
          },
          { text: "should not be reached" },
        ],
        {
          controller,
          onEvent: (event) => {
            if (event.type === "tool.started") {
              controller.abort();
            }
          },
        },
      );
      const outcome = await runAgent(options);

      expect(outcome.status).toBe("cancelled");
      expect(outcome.errorCode).toBe("cancelled");
      const completed = events.filter((event) => event.type === "run.completed");
      expect(completed).toHaveLength(1);
      expect(completed[0]?.type === "run.completed" && completed[0].status).toBe(
        "cancelled",
      );
    } finally {
      await repo.cleanup();
    }
  });

  it("reports invalid tool arguments and lets the model correct them", async () => {
    const repo = await createFixtureRepo({ "a.txt": "content\n" });
    try {
      const { options, events } = baseOptions(repo.root, [
        {
          toolCalls: [{ name: "read_file", arguments: { path: 42 } }],
        },
        {
          toolCalls: [{ name: "read_file", arguments: { path: "a.txt" } }],
        },
        { text: "Fixed the call." },
      ]);
      const outcome = await runAgent(options);

      expect(outcome.status).toBe("completed");
      const finished = events.filter((event) => event.type === "tool.finished");
      expect(finished[0]?.type === "tool.finished" && finished[0].result.status).toBe(
        "error",
      );
      if (finished[0]?.type === "tool.finished" && finished[0].result.status === "error") {
        expect(finished[0].result.error.code).toBe("invalid_arguments");
      }
      expect(finished[1]?.type === "tool.finished" && finished[1].result.status).toBe(
        "ok",
      );
    } finally {
      await repo.cleanup();
    }
  });

  it("refuses tool paths that escape the workspace", async () => {
    const repo = await createFixtureRepo({ "a.txt": "content\n" });
    try {
      const { options, events } = baseOptions(repo.root, [
        { toolCalls: [{ name: "read_file", arguments: { path: "../../etc/passwd" } }] },
        { text: "Stopped." },
      ]);
      await runAgent(options);
      const finished = events.find((event) => event.type === "tool.finished");
      expect(finished?.type === "tool.finished" && finished.result.status).toBe("error");
      if (finished?.type === "tool.finished" && finished.result.status === "error") {
        expect(finished.result.error.code).toBe("not_permitted");
      }
    } finally {
      await repo.cleanup();
    }
  });

  it("fails with step_budget_exceeded instead of looping forever", async () => {
    const repo = await createFixtureRepo({ "a.txt": "content\n" });
    try {
      const repeated: ScriptedTurn = {
        toolCalls: [{ name: "read_file", arguments: { path: "a.txt" } }],
      };
      const { options } = baseOptions(
        repo.root,
        [repeated, repeated, repeated, repeated],
        {
          limits: {
            maxSteps: 2,
            maxTokens: 100_000,
            maxWallClockMs: 30_000,
            maxParallelSubagents: 4,
          },
        },
      );
      const outcome = await runAgent(options);
      expect(outcome.status).toBe("failed");
      expect(outcome.errorCode).toBe("step_budget_exceeded");
      expect(outcome.steps).toBe(2);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("parallel subagents", () => {
  it("bounds concurrency and preserves task order", async () => {
    const tasks = ["a", "b", "c", "d", "e", "f"];
    let active = 0;
    let maxActive = 0;
    const started: string[] = [];

    const outcomes = await runParallelSubagents(tasks, {
      maxParallel: 3,
      onStart: (task) => {
        started.push(task);
      },
      spawn: async (task) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { status: "completed", summary: `done ${task}` };
      },
    });

    expect(maxActive).toBe(3);
    expect(started).toHaveLength(6);
    expect(outcomes.map((outcome) => outcome.task)).toEqual(tasks);
    expect(outcomes.every((outcome) => outcome.status === "completed")).toBe(true);
  });

  it("reports failures per task without failing the batch", async () => {
    const outcomes = await runParallelSubagents(["ok", "boom"], {
      maxParallel: 2,
      spawn: async (task) => {
        if (task === "boom") {
          throw new Error("subagent crashed");
        }
        return { status: "completed", summary: task };
      },
    });
    expect(outcomes[0]?.status).toBe("completed");
    expect(outcomes[1]?.status).toBe("failed");
    expect(outcomes[1]?.summary).toContain("subagent crashed");
  });
});
