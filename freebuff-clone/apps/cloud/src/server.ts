import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DockerSandboxProvider,
  LocalProcessPreviewProvider,
  SandboxManager,
  runProcess,
} from "@freebuff/sandbox-orchestrator";
import type { SandboxProvider } from "@freebuff/sandbox-orchestrator";
import { AdEngine, defaultAdInventory, InMemoryAdEventStore } from "@freebuff/ads";
import { createCloudApp } from "./app";

const workspaceRoot = join(tmpdir(), "freebuff-sandboxes");

const dockerAvailable = async (): Promise<boolean> => {
  const result = await runProcess("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeoutMs: 5000,
  }).catch(() => undefined);
  return result !== undefined && result.exitCode === 0;
};

const selectProvider = async (): Promise<{
  provider: SandboxProvider;
  name: string;
  hint: string;
}> => {
  if (await dockerAvailable()) {
    return {
      provider: new DockerSandboxProvider({ workspaceRoot }),
      name: "docker",
      hint: "Each repository runs in its own container with a read-only root, no capabilities and a dedicated network.",
    };
  }
  if (process.env["FREEBUFF_ALLOW_LOCAL_PREVIEW"] === "1") {
    return {
      provider: new LocalProcessPreviewProvider({
        rootDirectory: workspaceRoot,
        allowUnsafeLocalProcess: true,
        allowFileProtocol: true,
      }),
      name: "local-process (NOT isolated)",
      hint: "Development only: previews run as local processes and are not a security boundary.",
    };
  }
  process.stderr.write(
    [
      "No sandbox runtime available.",
      "Either give this user access to the Docker daemon, or set FREEBUFF_ALLOW_LOCAL_PREVIEW=1",
      "to run non-isolated local previews for development.",
      "",
    ].join("\n"),
  );
  process.exit(1);
};

const main = async (): Promise<void> => {
  const selection = await selectProvider();
  const manager = new SandboxManager(selection.provider, {
    maxSandboxesPerTenant: 3,
  });
  const app = createCloudApp({
    manager,
    providerName: selection.name,
    previewHint: selection.hint,
    ads: new AdEngine({
      inventory: defaultAdInventory,
      store: new InMemoryAdEventStore(),
    }),
  });

  const port = Number.parseInt(process.env["PORT"] ?? "3001", 10);
  Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });

  const reaper = setInterval(() => {
    void manager.reapExpired();
  }, 60_000);
  reaper.unref();

  process.stdout.write(
    `freebuff cloud listening on http://0.0.0.0:${String(port)} (provider: ${selection.name})\n`,
  );
};

await main();
