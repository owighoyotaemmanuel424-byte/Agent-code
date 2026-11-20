import { describe, expect, it } from "vitest";
import { runAgent } from "@freebuff/agent-runtime";
import type { Harness } from "../../support/harness";
import { createHarness, TEST_LIMITS } from "../../support/harness";
import { createFixtureRepo, readFixture } from "../../support/fixture-repo";
import { ScriptedModel } from "../../support/scripted-model";
import type { ScriptedTurn } from "../../support/scripted-model";
import {
  agentIdSchema,
  newId,
  nowIso,
  runIdSchema,
  sessionIdSchema,
} from "@freebuff/shared";

/**
 * Phase 1 gate: the agent must edit a real fixture repository correctly on five
 * scripted tasks, driving the actual tools (filesystem, ripgrep, process).
 */
const runScriptedAgent = async (
  root: string,
  turns: readonly ScriptedTurn[],
  options: { readonly emit?: Parameters<typeof createHarness>[1] } = {},
): Promise<{ harness: Harness; outcome: Awaited<ReturnType<typeof runAgent>>; model: ScriptedModel }> => {
  const harness = createHarness(root, options.emit ?? {});
  const model = new ScriptedModel(turns);
  const outcome = await runAgent({
    model,
    modelId: "scripted-model",
    maxOutputTokens: 4096,
    runId: runIdSchema.parse(newId()),
    sessionId: sessionIdSchema.parse(newId()),
    agentId: agentIdSchema.parse(newId()),
    surface: "cli",
    systemPrompt: "You are a coding agent. Use tools, then answer.",
    messages: [
      {
        id: newId(),
        role: "user",
        content: "Complete the task.",
        createdAt: nowIso(),
      },
    ],
    limits: TEST_LIMITS,
    registry: harness.registry,
    context: harness.context,
    emit: harness.emit,
    signal: harness.controller.signal,
  });
  return { harness, outcome, model };
};

const toolResults = (harness: Harness): { status: string; name?: string }[] =>
  harness.events.flatMap((event) =>
    event.type === "tool.finished"
      ? [{ status: event.result.status, name: undefined }]
      : [],
  );

describe("Phase 1 gate: scripted fixture tasks", () => {
  it("task 1 — adds an exported function to an existing file", async () => {
    const repo = await createFixtureRepo({
      "src/math.ts": "export const add = (a: number, b: number): number => a + b;\n",
    });
    try {
      const { outcome, harness } = await runScriptedAgent(repo.root, [
        { toolCalls: [{ name: "read_file", arguments: { path: "src/math.ts" } }] },
        {
          text: "Adding a subtract helper.",
          toolCalls: [
            {
              name: "edit_file",
              arguments: {
                path: "src/math.ts",
                oldString: "export const add",
                newString:
                  "export const subtract = (a: number, b: number): number => a - b;\n\nexport const add",
              },
            },
          ],
        },
        { text: "Added subtract to src/math.ts." },
      ]);

      expect(outcome.status).toBe("completed");
      const content = await readFixture(repo.root, "src/math.ts");
      expect(content).toContain("export const subtract");
      expect(content).toContain("export const add");
      expect(toolResults(harness).every((result) => result.status === "ok")).toBe(true);
      expect(outcome.summary).toContain("Added subtract");
    } finally {
      await repo.cleanup();
    }
  });

  it("task 2 — fixes a bug in an existing file", async () => {
    const repo = await createFixtureRepo({
      "src/parser.ts": [
        "export const countItems = (items: string[]): number => {",
        "  return items.lenght;",
        "};",
        "",
      ].join("\n"),
    });
    try {
      const { outcome } = await runScriptedAgent(repo.root, [
        { toolCalls: [{ name: "read_file", arguments: { path: "src/parser.ts" } }] },
        {
          text: "Fixing the typo.",
          toolCalls: [
            {
              name: "edit_file",
              arguments: {
                path: "src/parser.ts",
                oldString: "items.lenght",
                newString: "items.length",
              },
            },
          ],
        },
        { text: "Fixed the length typo." },
      ]);

      expect(outcome.status).toBe("completed");
      const content = await readFixture(repo.root, "src/parser.ts");
      expect(content).toContain("items.length");
      expect(content).not.toContain("lenght");
    } finally {
      await repo.cleanup();
    }
  });

  it("task 3 — renames a symbol across two files with one atomic patch", async () => {
    const repo = await createFixtureRepo({
      "src/a.ts": "export const oldName = 41;\n",
      "src/b.ts": 'import { oldName } from "./a";\n\nexport const answer = oldName + 1;\n',
    });
    try {
      const { outcome, harness } = await runScriptedAgent(repo.root, [
        {
          toolCalls: [
            { name: "read_file", arguments: { path: "src/a.ts" } },
            { name: "read_file", arguments: { path: "src/b.ts" } },
          ],
        },
        {
          text: "Renaming across both files.",
          toolCalls: [
            {
              name: "patch_files",
              arguments: {
                patches: [
                  { path: "src/a.ts", oldString: "oldName", newString: "newName" },
                  { path: "src/b.ts", oldString: "oldName", newString: "newName" },
                ],
              },
            },
          ],
        },
        {
          text: "Verifying the rename.",
          toolCalls: [
            { name: "search_code", arguments: { pattern: "oldName", fixedStrings: true } },
          ],
        },
        { text: "Rename complete." },
      ]);

      expect(outcome.status).toBe("completed");
      expect(await readFixture(repo.root, "src/a.ts")).toContain("newName");
      const bFile = await readFixture(repo.root, "src/b.ts");
      expect(bFile).toContain("newName");
      expect(bFile).not.toContain("oldName");

      const searchResult = harness.events.find(
        (event) => event.type === "tool.finished" && event.result.status === "ok",
      );
      expect(searchResult).toBeDefined();
      expect(toolResults(harness).every((result) => result.status === "ok")).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });

  it("task 4 — creates a file and runs it through the command broker", async () => {
    const repo = await createFixtureRepo({});
    try {
      const { outcome, harness } = await runScriptedAgent(repo.root, [
        {
          text: "Writing the script.",
          toolCalls: [
            {
              name: "write_file",
              arguments: {
                path: "scripts/hello.mjs",
                content: "console.log('hello from fixture');\n",
              },
            },
          ],
        },
        {
          text: "Running it.",
          toolCalls: [
            {
              name: "run_command",
              arguments: { command: "node", args: ["scripts/hello.mjs"] },
            },
          ],
        },
        { text: "The script printed the expected output." },
      ]);

      expect(outcome.status).toBe("completed");
      expect(await readFixture(repo.root, "scripts/hello.mjs")).toContain(
        "hello from fixture",
      );

      const finished = harness.events.filter(
        (event) => event.type === "tool.finished",
      );
      const commandEvent = finished.at(-1);
      expect(commandEvent?.type).toBe("tool.finished");
      if (commandEvent?.type === "tool.finished" && commandEvent.result.status === "ok") {
        const output = commandEvent.result.output as {
          exitCode: number;
          stdout: string;
        };
        expect(output.exitCode).toBe(0);
        expect(output.stdout).toContain("hello from fixture");
      }
    } finally {
      await repo.cleanup();
    }
  });

  it("task 5 — recovers from a failed tool call and still completes the edit", async () => {
    const repo = await createFixtureRepo({
      "src/exists.ts": "export const value = 1;\n",
    });
    try {
      const { outcome, harness } = await runScriptedAgent(repo.root, [
        {
          text: "Reading the file.",
          toolCalls: [{ name: "read_file", arguments: { path: "src/missing.ts" } }],
        },
        {
          text: "That path does not exist, trying the real one.",
          toolCalls: [{ name: "read_file", arguments: { path: "src/exists.ts" } }],
        },
        {
          text: "Appending an export.",
          toolCalls: [
            {
              name: "edit_file",
              arguments: {
                path: "src/exists.ts",
                oldString: "export const value = 1;",
                newString: "export const value = 1;\nexport const doubled = value * 2;",
              },
            },
          ],
        },
        { text: "Recovered and updated the file." },
      ]);

      expect(outcome.status).toBe("completed");
      const results = harness.events.filter(
        (event) => event.type === "tool.finished",
      );
      expect(results[0]?.type === "tool.finished" && results[0].result.status).toBe(
        "error",
      );
      expect(await readFixture(repo.root, "src/exists.ts")).toContain("doubled");
      expect(outcome.steps).toBe(4);
    } finally {
      await repo.cleanup();
    }
  });
});
