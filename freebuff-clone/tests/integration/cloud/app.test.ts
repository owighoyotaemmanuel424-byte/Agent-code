import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalProcessPreviewProvider,
  SandboxManager,
  runProcess,
} from "@freebuff/sandbox-orchestrator";
import { createCloudApp } from "../../../apps/cloud/src/app";
import type { SandboxStatus } from "@freebuff/sandbox-orchestrator";
import { createFixtureRepo } from "../../support/fixture-repo";

const SITE = {
  "index.html": "<!doctype html><html><body><h1>cloud preview</h1></body></html>",
};

const initGitRepo = async (root: string): Promise<void> => {
  const run = (args: readonly string[]) =>
    runProcess("git", args, { cwd: root, timeoutMs: 60_000 });
  await run(["init", "-q"]);
  await run(["add", "."]);
  const commit = await run([
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Freebuff Test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "-m",
    "fixture",
  ]);
  if (commit.exitCode !== 0) {
    throw new Error(commit.stderr);
  }
};

describe("cloud sandbox API", () => {
  it("creates, lists, shares and removes a sandbox", async () => {
    const repo = await createFixtureRepo(SITE);
    const sandboxRoot = await mkdtemp(join(tmpdir(), "freebuff-cloud-"));
    try {
      await initGitRepo(repo.root);
      const provider = new LocalProcessPreviewProvider({
        rootDirectory: sandboxRoot,
        allowUnsafeLocalProcess: true,
        allowFileProtocol: true,
        bootTimeoutMs: 60_000,
      });
      const app = createCloudApp({
        manager: new SandboxManager(provider),
        providerName: "local-process (test)",
      });
      const origin = "http://cloud.test";

      const health = await app.fetch(new Request(`${origin}/healthz`));
      expect(health.status).toBe(200);

      const dashboard = await app.fetch(new Request(`${origin}/`));
      expect(dashboard.status).toBe(200);
      expect(await dashboard.text()).toContain("freebuff cloud sandboxes");

      const invalid = await app.fetch(
        new Request(`${origin}/api/sandboxes`, {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(invalid.status).toBe(422);

      const created = await app.fetch(
        new Request(`${origin}/api/sandboxes`, {
          method: "POST",
          body: JSON.stringify({ repoUrl: `file://${repo.root}` }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(created.status).toBe(201);
      const payload = (await created.json()) as {
        previewUrl: string;
        sandbox: SandboxStatus;
      };
      const sandboxId = String(payload.sandbox.sandboxId);
      expect(await (await fetch(payload.previewUrl)).text()).toContain(
        "cloud preview",
      );

      const list = await app.fetch(new Request(`${origin}/api/sandboxes`));
      const listed = (await list.json()) as { sandboxes: SandboxStatus[] };
      expect(listed.sandboxes).toHaveLength(1);

      const share = await app.fetch(
        new Request(`${origin}/api/sandboxes/${sandboxId}/share`),
      );
      expect((await share.json()) as { url: string }).toMatchObject({
        url: payload.previewUrl,
      });

      const logs = await app.fetch(
        new Request(`${origin}/api/sandboxes/${sandboxId}/logs`),
      );
      expect(((await logs.json()) as { logs: string }).logs).toContain("preview ready");

      const unknown = await app.fetch(
        new Request(`${origin}/api/sandboxes/does-not-exist`),
      );
      expect(unknown.status).toBe(404);

      const stopped = await app.fetch(
        new Request(`${origin}/api/sandboxes/${sandboxId}/stop`, { method: "POST" }),
      );
      expect(stopped.status).toBe(200);

      const removed = await app.fetch(
        new Request(`${origin}/api/sandboxes/${sandboxId}`, { method: "DELETE" }),
      );
      expect(removed.status).toBe(200);
      const gone = await app.fetch(
        new Request(`${origin}/api/sandboxes/${sandboxId}`),
      );
      expect(gone.status).toBe(404);
    } finally {
      await repo.cleanup();
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
