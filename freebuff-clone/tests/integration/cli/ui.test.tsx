/** @jsxImportSource @opentui/react */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testRender } from "@opentui/react/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "../../../apps/cli/src/ui/App";
import { addProject } from "../../../apps/cli/src/core/projects";
import { loadConfig } from "../../../apps/cli/src/core/config";
import { ChatHistoryStore } from "../../../apps/cli/src/core/history";
import { saveCredentials } from "../../../apps/cli/src/core/credentials";
import { defaultAdInventory } from "../../../apps/cli/src/core/inventory";
import { resolveCliPaths } from "../../../apps/cli/src/core/paths";
import { createLocalPlatform } from "../../../apps/cli/src/core/platform";
import { createFixtureRepo } from "../../support/fixture-repo";
import { ScriptedModel } from "../../support/scripted-model";

describe("CLI terminal interface", () => {
  it("renders the header, prompt and project name", async () => {
    const home = await mkdtemp(join(tmpdir(), "freebuff-ui-"));
    const repo = await createFixtureRepo({ "a.txt": "a" });
    try {
      const paths = resolveCliPaths({ FREEBUFF_HOME: home });
      const platform = await createLocalPlatform(paths);
      const link = await platform.requestMagicLink("ui@example.com");
      const session = await platform.completeMagicLink(link.token);
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
      const model = new ScriptedModel([{ text: "unused" }]);

      const setup = await testRender(
        <QueryClientProvider client={new QueryClient()}>
          <App
            platform={platform}
            credentials={credentials}
            config={config}
            project={project}
            modelId="scripted-model"
            countryCode="US"
            history={new ChatHistoryStore(paths.sessionsDir)}
            inventory={defaultAdInventory}
            resolveModel={() => ({ model, maxOutputTokens: 1024 })}
            onQuit={() => undefined}
          />
        </QueryClientProvider>,
        { width: 100, height: 30 },
      );
      try {
        await setup.renderOnce();
        const frame = await setup.waitForFrame((text) =>
          text.includes("ui-project"),
        );
        expect(frame).toContain("freebuff");
        expect(frame).toContain("ui-project");
        expect(frame).toContain("Describe the change");
      } finally {
        await setup.dispose();
      }
    } finally {
      await repo.cleanup();
      await rm(home, { recursive: true, force: true });
    }
  });
});
