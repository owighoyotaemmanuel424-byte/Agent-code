import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalProcessPreviewProvider,
  SandboxManager,
  runProcess,
} from "@freebuff/sandbox-orchestrator";
import { sandboxIdSchema } from "@freebuff/shared";
import { createFixtureRepo } from "../../support/fixture-repo";

const STATIC_SITE = {
  "index.html": [
    "<!doctype html>",
    "<html><body><h1>sandbox preview</h1></body></html>",
    "",
  ].join("\n"),
};

const NODE_APP = {
  "package.json": JSON.stringify(
    {
      name: "sandbox-fixture",
      private: true,
      scripts: { dev: "node server.mjs" },
    },
    null,
    2,
  ),
  "package-lock.json": JSON.stringify({
    name: "sandbox-fixture",
    lockfileVersion: 3,
    requires: true,
    packages: {},
  }),
  "server.mjs": [
    'import { createServer } from "node:http";',
    "const port = Number(process.env.PORT ?? 3000);",
    "createServer((request, response) => {",
    '  response.writeHead(200, { "content-type": "text/html" });',
    '  response.end("<h1>node sandbox preview</h1>");',
    '}).listen(port, "0.0.0.0");',
    "",
  ].join("\n"),
  ".gitignore": "node_modules\n",
};

/** A non-bare local repository stands in for a GitHub remote in tests. */
const initGitRepo = async (root: string): Promise<void> => {
  const run = (args: readonly string[]) =>
    runProcess("git", args, { cwd: root, timeoutMs: 60_000 });
  const init = await run(["init", "-q"]);
  if (init.exitCode !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
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
    throw new Error(`git commit failed: ${commit.stderr}`);
  }
};

const createProvider = (root: string) =>
  new LocalProcessPreviewProvider({
    rootDirectory: root,
    allowUnsafeLocalProcess: true,
    allowFileProtocol: true,
    bootTimeoutMs: 60_000,
    installTimeoutMs: 120_000,
  });

const fetchText = async (url: string): Promise<string> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  return response.text();
};

describe("Phase 3 gate: sandbox preview", () => {
  it("clones a repository and serves a reachable preview in under 120s", async () => {
    const repo = await createFixtureRepo(STATIC_SITE);
    const sandboxRoot = await mkdtemp(join(tmpdir(), "freebuff-sandbox-"));
    try {
      await initGitRepo(repo.root);
      const provider = createProvider(sandboxRoot);
      const startedAt = Date.now();
      const handle = await provider.create(
        sandboxIdSchema.parse("11111111-1111-4111-8111-111111111111"),
        { repoUrl: `file://${repo.root}`, tenantId: "tenant-a" },
      );
      const elapsedMs = Date.now() - startedAt;

      expect(handle.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(elapsedMs).toBeLessThan(120_000);
      expect(await fetchText(handle.previewUrl)).toContain("sandbox preview");
      expect(handle.status.phase).toBe("ready");
      expect(handle.stack).toBe("static");

      const logs = await provider.logs(handle.sandboxId);
      expect(logs).toContain("preview ready");

      await provider.remove(handle.sandboxId);
      await expect(fetchText(handle.previewUrl)).rejects.toBeTruthy();
    } finally {
      await repo.cleanup();
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("installs dependencies and starts a detected Node app", async () => {
    const repo = await createFixtureRepo(NODE_APP);
    const sandboxRoot = await mkdtemp(join(tmpdir(), "freebuff-sandbox-"));
    try {
      await initGitRepo(repo.root);
      const provider = createProvider(sandboxRoot);
      const handle = await provider.create(
        sandboxIdSchema.parse("22222222-2222-4222-8222-222222222222"),
        { repoUrl: `file://${repo.root}`, tenantId: "tenant-node" },
      );

      expect(handle.stack).toBe("node");
      expect(await fetchText(handle.previewUrl)).toContain("node sandbox preview");
      const logs = await provider.logs(handle.sandboxId);
      expect(logs).toContain("install exit 0");

      await provider.remove(handle.sandboxId);
    } finally {
      await repo.cleanup();
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }, 180_000);

  it("isolates tenants and enforces ownership through the manager", async () => {
    const repo = await createFixtureRepo(STATIC_SITE);
    const sandboxRoot = await mkdtemp(join(tmpdir(), "freebuff-sandbox-"));
    try {
      await initGitRepo(repo.root);
      const manager = new SandboxManager(createProvider(sandboxRoot), {
        maxSandboxesPerTenant: 2,
      });
      const repoUrl = `file://${repo.root}`;
      const a = await manager.create("tenant-a", { repoUrl });
      const b = await manager.create("tenant-b", { repoUrl });

      expect(a.previewUrl).not.toBe(b.previewUrl);
      expect(await fetchText(a.previewUrl)).toContain("sandbox preview");
      expect(await fetchText(b.previewUrl)).toContain("sandbox preview");

      const aDirectory = join(sandboxRoot, "tenant-a", String(a.sandboxId));
      const bDirectory = join(sandboxRoot, "tenant-b", String(b.sandboxId));
      expect((await stat(aDirectory)).isDirectory()).toBe(true);
      expect((await stat(bDirectory)).isDirectory()).toBe(true);

      await expect(manager.status(String(b.sandboxId), "tenant-a")).rejects.toThrow(
        /Not your sandbox/,
      );
      expect(await manager.shareLink(String(b.sandboxId), "tenant-b")).toBe(
        b.previewUrl,
      );
      expect(await manager.list("tenant-a")).toHaveLength(1);
      expect(await manager.list("tenant-b")).toHaveLength(1);

      // Per-tenant sandbox limit is enforced.
      await manager.create("tenant-a", { repoUrl });
      await expect(manager.create("tenant-a", { repoUrl })).rejects.toThrow(
        /Sandbox limit reached/,
      );

      await manager.stop(String(a.sandboxId), "tenant-a");
      await expect(fetchText(a.previewUrl)).rejects.toBeTruthy();
    } finally {
      await repo.cleanup();
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }, 180_000);

  it("refuses to clone non-HTTPS repositories unless explicitly allowed", async () => {
    const repo = await createFixtureRepo(STATIC_SITE);
    try {
      await initGitRepo(repo.root);
      const strict = new LocalProcessPreviewProvider({
        rootDirectory: join(repo.root, "..", "sandbox-strict"),
        allowUnsafeLocalProcess: true,
      });
      await expect(
        strict.create(sandboxIdSchema.parse("33333333-3333-4333-8333-333333333333"), {
          repoUrl: `file://${repo.root}`,
          tenantId: "tenant-strict",
        }),
      ).rejects.toThrow(/Only HTTPS repository URLs/);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});
