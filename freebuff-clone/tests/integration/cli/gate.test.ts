import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSponsoredAd } from "@freebuff/ads";
import { QuotaExceededError } from "@freebuff/shared";
import { addProject, pickProject, resolveProject, setDefaultProject } from "../../../apps/cli/src/core/projects";
import { loadConfig, saveConfig } from "../../../apps/cli/src/core/config";
import { ChatHistoryStore } from "../../../apps/cli/src/core/history";
import { defaultAdInventory } from "../../../apps/cli/src/core/inventory";
import { loadCredentials, requireCredentials, saveCredentials } from "../../../apps/cli/src/core/credentials";
import { resolveCliPaths } from "../../../apps/cli/src/core/paths";
import { createLocalPlatform } from "../../../apps/cli/src/core/platform";
import { runChatTurn } from "../../../apps/cli/src/core/session";
import type { StoredCredentials } from "../../../apps/cli/src/core/credentials";
import { createFixtureRepo, readFixture } from "../../support/fixture-repo";
import { ScriptedModel } from "../../support/scripted-model";
import type { ScriptedTurn } from "../../support/scripted-model";

interface Environment {
  readonly home: string;
  readonly paths: ReturnType<typeof resolveCliPaths>;
  readonly credentials: StoredCredentials;
  readonly cleanup: () => Promise<void>;
}

const createEnvironment = async (): Promise<Environment> => {
  const home = await mkdtemp(join(tmpdir(), "freebuff-cli-"));
  const paths = resolveCliPaths({ FREEBUFF_HOME: home });
  const platform = await createLocalPlatform(paths);
  const link = await platform.requestMagicLink("dev@example.com");
  const session = await platform.completeMagicLink(link.token);
  const credentials = await saveCredentials(paths, {
    token: session.sessionToken,
    userId: session.user.id,
    email: session.user.email,
  });
  return {
    home,
    paths,
    credentials,
    cleanup: async () => {
      await rm(home, { recursive: true, force: true });
    },
  };
};

const deps = (
  platform: Awaited<ReturnType<typeof createLocalPlatform>>,
  history: ChatHistoryStore,
  model: ScriptedModel,
) => ({
  platform,
  history,
  inventory: defaultAdInventory,
  countryCode: "US",
  resolveModel: () => ({ model, maxOutputTokens: 4096 }),
});

describe("Phase 2 gate: CLI end to end", () => {
  it("runs sign-in → project picker → multi-file edit → command → persisted history", async () => {
    const environment = await createEnvironment();
    const repo = await createFixtureRepo({
      "src/app.ts": "export const name = 'app';\nexport const version = 1;\n",
      "src/util.ts": "export const format = (value: number): string => `v${value}`;\n",
    });
    try {
      const { config, project } = await addProject(environment.paths, { path: repo.root });
      // The project picker resolves by name and by saved default.
      expect(resolveProject(config, project.name)?.id).toBe(project.id);
      await setDefaultProject(environment.paths, project.name);
      const picked = await pickProject(await loadConfig(environment.paths));
      expect(picked.path).toBe(project.path);

      const platform = await createLocalPlatform(environment.paths);
      const history = new ChatHistoryStore(environment.paths.sessionsDir);
      const turns: ScriptedTurn[] = [
        {
          toolCalls: [
            { name: "read_file", arguments: { path: "src/app.ts" } },
            { name: "read_file", arguments: { path: "src/util.ts" } },
          ],
        },
        {
          text: "Updating both modules.",
          toolCalls: [
            {
              name: "patch_files",
              arguments: {
                patches: [
                  {
                    path: "src/app.ts",
                    oldString: "export const version = 1;",
                    newString:
                      "export const version = 2;\nexport const label = `${name}@${version}`;",
                  },
                  {
                    path: "src/util.ts",
                    oldString: "export const format",
                    newString:
                      "export const upper = (value: string): string => value.toUpperCase();\n\nexport const format",
                  },
                ],
              },
            },
          ],
        },
        {
          text: "Adding a check script.",
          toolCalls: [
            {
              name: "write_file",
              arguments: {
                path: "scripts/check.mjs",
                content:
                  "console.log('version check passed');\nif (1 !== 1) process.exit(1);\n",
              },
            },
          ],
        },
        {
          text: "Running the check.",
          toolCalls: [
            {
              name: "run_command",
              arguments: { command: "node", args: ["scripts/check.mjs"] },
            },
          ],
        },
        { text: "Updated both modules and verified the check script." },
      ];
      const model = new ScriptedModel(turns);

      const result = await runChatTurn(deps(platform, history, model), {
        credentials: environment.credentials,
        project,
        prompt: "fix the tests and add helpers to both modules",
        modelId: "scripted-model",
        signal: new AbortController().signal,
        emit: () => undefined,
      });

      expect(result.outcome.status).toBe("completed");
      expect(result.outcome.steps).toBe(5);

      expect(await readFixture(repo.root, "src/app.ts")).toContain(
        "export const label",
      );
      expect(await readFixture(repo.root, "src/app.ts")).toContain("version = 2");
      expect(await readFixture(repo.root, "src/util.ts")).toContain(
        "export const upper",
      );

      // The command broker really executed the script inside the fixture.
      const commandRun = result.outcome.messages.filter(
        (message) => message.role === "tool",
      );
      expect(
        commandRun.some((message) => message.content.includes("version check passed")),
      ).toBe(true);

      // A sponsored slot was served, labelled, for the free tier.
      expect(result.ad).toBeDefined();
      if (result.ad !== undefined) {
        expect(result.ad.ad.label).toBe("Sponsored");
        expect(formatSponsoredAd(result.ad.ad)[0]?.startsWith("Sponsored")).toBe(true);
        expect(result.ad.rationale).toBe("contextual");
      }

      // History persists the whole exchange, including tool messages.
      const latest = await history.latest(project.id);
      expect(latest?.id).toBe(result.sessionId);
      const stored = await history.load(result.sessionId);
      expect(stored?.messages[0]?.role).toBe("user");
      expect(stored?.messages.some((message) => message.role === "assistant")).toBe(true);
      expect(stored?.messages.filter((message) => message.role === "tool").length).toBeGreaterThan(1);

      // A fresh platform instance (new process equivalent) still authenticates
      // the saved token and keeps the charged hour.
      const reopened = await createLocalPlatform(environment.paths);
      const user = await reopened.verifySession(environment.credentials.token);
      expect(user.email).toBe("dev@example.com");
      const quota = await reopened.quotaSnapshot({
        userId: user.id,
        plan: user.plan,
        countryCode: "US",
        phoneVerified: user.phoneVerified,
      });
      expect(quota.snapshot.consumedSecondsToday).toBe(3600);
      expect(await loadCredentials(environment.paths)).toBeDefined();
    } finally {
      await repo.cleanup();
      await environment.cleanup();
    }
  });

  it("refuses to start a run once the daily hour allowance is gone", async () => {
    const environment = await createEnvironment();
    const repo = await createFixtureRepo({ "a.txt": "content\n" });
    try {
      let now = new Date("2026-11-19T09:00:00.000Z");
      const platform = await createLocalPlatform(environment.paths, {
        now: () => now,
        quotaConfig: {
          version: 1,
          default: { timeZone: "UTC", freeHoursPerDay: 1, paidHoursPerDay: 10 },
          countries: [],
        },
      });
      const { project } = await addProject(environment.paths, { path: repo.root });
      const history = new ChatHistoryStore(environment.paths.sessionsDir);
      const model = new ScriptedModel([{ text: "should never run" }]);

      const first = await runChatTurn(deps(platform, history, model), {
        credentials: environment.credentials,
        project,
        prompt: "first turn",
        modelId: "scripted-model",
        signal: new AbortController().signal,
        emit: () => undefined,
      });
      expect(first.outcome.status).toBe("completed");
      expect(model.requests).toHaveLength(1);

      // Move past the active hour, so the allowance is genuinely gone.
      now = new Date(now.getTime() + 61 * 60 * 1000);
      await expect(
        runChatTurn(deps(platform, history, model), {
          credentials: environment.credentials,
          project,
          prompt: "second turn",
          modelId: "scripted-model",
          signal: new AbortController().signal,
          emit: () => undefined,
        }),
      ).rejects.toBeInstanceOf(QuotaExceededError);

      // The model was never called for the blocked turn.
      expect(model.requests).toHaveLength(1);
    } finally {
      await repo.cleanup();
      await environment.cleanup();
    }
  });

  it("requires an explicit project when several are registered", async () => {
    const environment = await createEnvironment();
    const first = await createFixtureRepo({ "a.txt": "a" });
    const second = await createFixtureRepo({ "b.txt": "b" });
    try {
      await addProject(environment.paths, { path: first.root, name: "first" });
      await addProject(environment.paths, { path: second.root, name: "second" });
      const config = await loadConfig(environment.paths);

      // addProject adopts the first project as the default; clear it so the
      // picker path is actually exercised.
      await saveConfig(environment.paths, {
        ...config,
        defaultProjectId: undefined,
      });
      const undefaulted = await loadConfig(environment.paths);

      let prompted: readonly string[] = [];
      const picked = await pickProject(undefaulted, {
        selector: undefined,
        picker: async (projects, index) => {
          prompted = projects.map((project) => project.name);
          return projects[index + 1];
        },
        remember: async () => undefined,
      });
      expect(prompted).toEqual(["first", "second"]);
      expect(picked.name).toBe("second");

      await expect(pickProject(await loadConfig(environment.paths))).rejects.toThrow(
        /--project/,
      );
    } finally {
      await first.cleanup();
      await second.cleanup();
      await environment.cleanup();
    }
  });

  it("persists credentials with owner-only permissions", async () => {
    const environment = await createEnvironment();
    try {
      const credentials = await requireCredentials(environment.paths);
      expect(credentials.email).toBe("dev@example.com");
      const { stat } = await import("node:fs/promises");
      const info = await stat(environment.paths.credentialsFile);
      expect(info.mode & 0o077).toBe(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("drives the real CLI binary through Commander", async () => {
    const environment = await createEnvironment();
    const repo = await createFixtureRepo({ "a.txt": "a" });
    try {
      await addProject(environment.paths, { path: repo.root, name: "cli-project" });
      const result = spawnSync("bun", ["src/index.ts", "projects", "list"], {
        cwd: join(process.cwd(), "apps/cli"),
        encoding: "utf8",
        env: { ...process.env, FREEBUFF_HOME: environment.home },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("cli-project");
      expect(result.stdout).toContain(repo.root);
    } finally {
      await repo.cleanup();
      await environment.cleanup();
    }
  });
});
