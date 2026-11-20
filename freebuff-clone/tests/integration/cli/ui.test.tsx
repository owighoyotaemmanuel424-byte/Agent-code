/** @jsxImportSource @opentui/react */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testRender } from "@opentui/react/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "../../../apps/cli/src/ui/App";
import type { ModelChoice } from "../../../apps/cli/src/ui/screens/screens";
import { addProject } from "../../../apps/cli/src/core/projects";
import { loadConfig } from "../../../apps/cli/src/core/config";
import { ChatHistoryStore } from "../../../apps/cli/src/core/history";
import { saveCredentials } from "../../../apps/cli/src/core/credentials";
import { defaultAdInventory } from "../../../apps/cli/src/core/inventory";
import { resolveCliPaths } from "../../../apps/cli/src/core/paths";
import { createLocalPlatform } from "../../../apps/cli/src/core/platform";
import { createFixtureRepo } from "../../support/fixture-repo";
import { ScriptedModel } from "../../support/scripted-model";

const models: readonly ModelChoice[] = [
  {
    id: "scripted-model",
    displayName: "Scripted Model",
    provider: "openai",
    planTiers: ["free", "paid"],
    allowed: true,
  },
  {
    id: "premium-model",
    displayName: "Premium Model",
    provider: "anthropic",
    planTiers: ["paid"],
    allowed: false,
  },
];

describe("CLI terminal interface", () => {
  it("drives auth → model picker → project picker → agent view → quota by keyboard", async () => {
    const home = await mkdtemp(join(tmpdir(), "freebuff-ui-"));
    const repo = await createFixtureRepo({ "a.txt": "a" });
    const setup = await (async () => {
      const paths = resolveCliPaths({ FREEBUFF_HOME: home });
      const platform = await createLocalPlatform(paths);
      const link = await platform.requestMagicLink("ui@example.com");
      const session = await platform.completeMagicLink(link.token);
      const phone = "+14155550123";
      const challenge = await platform.requestPhoneCode({
        userId: String(session.user.id),
        phone,
      });
      if (challenge.code !== undefined) {
        await platform.verifyPhoneCode({
          userId: String(session.user.id),
          phone,
          code: challenge.code,
        });
      }
      const credentials = await saveCredentials(paths, {
        token: session.sessionToken,
        userId: session.user.id,
        email: session.user.email,
      });
      const { project } = await addProject(paths, {
        path: repo.root,
        name: "ui-project",
      });
      const config = await loadConfig(paths);
      const model = new ScriptedModel([{ text: "All set." }]);
      let quit = false;
      const renderer = await testRender(
        <QueryClientProvider client={new QueryClient()}>
          <App
            platform={platform}
            credentials={credentials}
            config={config}
            project={project}
            modelId="scripted-model"
            countryCode="US"
            plan="free"
            models={models}
            recommendedModelId="scripted-model"
            history={new ChatHistoryStore(paths.sessionsDir)}
            inventory={defaultAdInventory}
            resolveModel={() => ({ model, maxOutputTokens: 1024 })}
            onQuit={() => {
              quit = true;
            }}
          />
        </QueryClientProvider>,
        { width: 100, height: 32 },
      );
      return { renderer, quit: () => quit };
    })();

    const settle = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await setup.renderer.flush();
    };
    try {
      await setup.renderer.renderOnce();

      const picker = await setup.renderer.waitForFrame((frame) =>
        frame.includes("UNLIMITED"),
      );
      expect(picker).toContain("Scripted Model");
      expect(picker).toContain("(recommended)");
      expect(picker).toContain("Premium Model");
      expect(picker).toContain("paid plan required");

      // Enter selects the recommended model and moves to the project list.
      setup.renderer.mockInput.pressEnter();
      await settle();
      const projects = await setup.renderer.waitForFrame((frame) =>
        frame.includes("RECENT PROJECTS"),
      );
      expect(projects).toContain("ui-project");

      setup.renderer.mockInput.pressEnter();
      await settle();
      const agent = await setup.renderer.waitForFrame((frame) =>
        frame.includes("Describe the change"),
      );
      expect(agent).toContain("ui-project");
      expect(agent).toContain("scripted-model");

      await setup.renderer.mockInput.typeText("fix the tests");
      setup.renderer.mockInput.pressEnter();
      await settle();
      const finished = await setup.renderer.waitForFrame((frame) =>
        frame.includes("All set."),
      );
      expect(finished).toContain("All set.");
      expect(finished).toContain("done");

      setup.renderer.mockInput.pressKey("u", { ctrl: true });
      await settle();
      const quota = await setup.renderer.waitForFrame((frame) =>
        frame.includes("Resets in"),
      );
      expect(quota).toContain("Today");
      expect(quota).toContain("Unlimited models");

      setup.renderer.mockInput.pressEscape();
      await settle();
      await setup.renderer.renderOnce();
      expect(setup.quit()).toBe(true);
    } finally {
      await setup.renderer.dispose();
      await repo.cleanup();
      await rm(home, { recursive: true, force: true });
    }
  });
});
