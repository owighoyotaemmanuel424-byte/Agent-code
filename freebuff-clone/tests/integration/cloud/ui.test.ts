import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalProcessPreviewProvider,
  SandboxManager,
  runProcess,
} from "@freebuff/sandbox-orchestrator";
import type { SandboxStatus } from "@freebuff/sandbox-orchestrator";
import { AdEngine, defaultAdInventory, InMemoryAdEventStore } from "@freebuff/ads";
import { createCloudApp } from "../../../apps/cloud/src/app";
import { previewPaneHtml, sandboxPageHtml } from "../../../apps/cloud/src/sandbox-ui";
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

const status = (overrides: Partial<SandboxStatus> = {}): SandboxStatus => ({
  sandboxId: "sbx-1" as SandboxStatus["sandboxId"],
  phase: "ready",
  previewUrl: "http://127.0.0.1:4100/",
  startedAt: "2026-11-20T10:00:00.000Z",
  logs: ["preview ready"],
  ...overrides,
});

describe("cloud sandbox list-detail UI", () => {
  it("renders the repository rail, empty detail and a labelled ad", async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "freebuff-cloud-ui-"));
    try {
      const provider = new LocalProcessPreviewProvider({
        rootDirectory: sandboxRoot,
        allowUnsafeLocalProcess: true,
        allowFileProtocol: true,
      });
      const app = createCloudApp({
        manager: new SandboxManager(provider),
        providerName: "local-process (test)",
        previewHint: "Previews are served from this host.",
        ads: new AdEngine({
          inventory: defaultAdInventory,
          store: new InMemoryAdEventStore(),
        }),
      });
      const response = await app.fetch(new Request("http://cloud.test/sandboxes"));
      expect(response.status).toBe(200);
      const html = await response.text();

      expect(html).toContain('id="create-form"');
      expect(html).toContain('id="repo-url"');
      expect(html).toContain("Repositories");
      expect(html).toContain("Connect GitHub");
      expect(html).toContain("GITHUB_CLIENT_ID");
      expect(html).toContain("No sandboxes yet");
      expect(html).toContain("No sandbox selected");
      expect(html).toContain('class="sponsored-ad"');
      expect(html).toContain('class="sponsored-label"');
      expect(html).toContain(">Sponsored<");
      expect(html).not.toContain('id="preview-frame"');
      expect(html).toContain("Overview");
      expect(html).toContain('aria-current="page"');
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("links the detail pane to the live preview and share flow", async () => {
    const repo = await createFixtureRepo(SITE);
    const sandboxRoot = await mkdtemp(join(tmpdir(), "freebuff-cloud-ui-"));
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
        ads: new AdEngine({
          inventory: defaultAdInventory,
          store: new InMemoryAdEventStore(),
        }),
      });
      const origin = "http://cloud.test";

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
      const id = String(payload.sandbox.sandboxId);

      const detail = await app.fetch(
        new Request(`${origin}/sandboxes?sandbox=${encodeURIComponent(id)}`),
      );
      expect(detail.status).toBe(200);
      const html = await detail.text();
      expect(html).toContain(`id="preview-frame"`);
      expect(html).toContain(`src="${payload.previewUrl}"`);
      expect(html).toContain('data-phase="ready"');
      expect(html).toContain("running");
      expect(html).toContain(`data-share="/api/sandboxes/${id}/share"`);
      expect(html).toContain(`value="${payload.previewUrl}"`);
      expect(html).toContain(`data-sandbox="${id}"`);
      expect(html).toContain("preview ready");
      expect(html).toContain(`href="/sandboxes?sandbox=${encodeURIComponent(id)}"`);

      // The share endpoint the button calls returns the same link the iframe uses.
      const share = await app.fetch(
        new Request(`${origin}/api/sandboxes/${id}/share`),
      );
      expect((await share.json()) as { url: string }).toEqual({ url: payload.previewUrl });

      // The preview pane itself never carries a sponsored slot.
      const preview = previewPaneHtml({
        status: status({ sandboxId: id as SandboxStatus["sandboxId"], previewUrl: payload.previewUrl }),
        shareUrl: payload.previewUrl,
      });
      expect(preview.toLowerCase()).not.toContain("sponsored");
      expect(preview).toContain("<iframe");

      // Stopping the sandbox settles the timeline and drops the iframe.
      const stopped = await app.fetch(
        new Request(`${origin}/api/sandboxes/${id}/stop`, { method: "POST" }),
      );
      expect(stopped.status).toBe(200);
      const stoppedPage = await (
        await app.fetch(new Request(`${origin}/sandboxes?sandbox=${encodeURIComponent(id)}`))
      ).text();
      expect(stoppedPage).toContain('data-phase="stopped"');
      expect(stoppedPage).not.toContain('id="preview-frame"');
    } finally {
      await repo.cleanup();
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("explains a missing sandbox inline and offers the GitHub control when configured", async () => {
    const missing = sandboxPageHtml({
      providerName: "docker",
      previewHint: "Containers.",
      sandboxes: [],
      notice: "Sandbox nope was not found in this workspace.",
    });
    expect(missing).toContain("was not found");
    expect(missing).toContain("No sandbox selected");

    const configured = sandboxPageHtml({
      providerName: "docker",
      previewHint: "Containers.",
      sandboxes: [status()],
      githubClientId: "client-123",
    });
    expect(configured).toContain("github.com/login/oauth/authorize?client_id=client-123");
    expect(configured).toContain('data-phase="ready"');
    expect(configured).not.toContain("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");

    const failed = sandboxPageHtml({
      providerName: "docker",
      previewHint: "Containers.",
      sandboxes: [status({ phase: "failed", error: "clone failed", previewUrl: undefined })],
      selected: status({ phase: "failed", error: "clone failed", previewUrl: undefined }),
    });
    expect(failed).toContain('data-state="failed"');
    expect(failed).toContain("clone failed");
    expect(failed).not.toContain('id="preview-frame"');
    expect(failed).toContain("No preview yet");
  });
});
