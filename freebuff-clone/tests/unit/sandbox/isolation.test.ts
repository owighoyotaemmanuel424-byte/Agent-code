import { describe, expect, it } from "vitest";
import {
  DockerCliRuntime,
  buildRunArgs,
} from "@freebuff/sandbox-orchestrator";
import type { CommandExecutor, ContainerRunSpec, ExecResult } from "@freebuff/sandbox-orchestrator";

const spec = (tenant: string): ContainerRunSpec => ({
  name: `freebuff-${tenant}`,
  image: "freebuff/sandbox-base:latest",
  env: { HOME: "/home/sandbox", CI: "1" },
  network: `fb-${tenant}`,
  workdir: "/workspace",
  volumes: [`/tmp/sandboxes/${tenant}/sandbox-1:/workspace:rw`],
  memoryMb: 1024,
  cpus: 1.5,
  pidsLimit: 256,
  publishContainerPort: 3000,
  command: ["sleep", "infinity"],
  labels: { "freebuff.tenant": tenant },
});

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

describe("container isolation arguments", () => {
  it("locks down the container by default", () => {
    const args = buildRunArgs(spec("a"));
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop");
    expect(valueAfter(args, "--cap-drop")).toBe("ALL");
    expect(valueAfter(args, "--security-opt")).toBe("no-new-privileges");
    expect(valueAfter(args, "--memory")).toBe("1024m");
    expect(valueAfter(args, "--cpus")).toBe("1.5");
    expect(valueAfter(args, "--pids-limit")).toBe("256");
    expect(valueAfter(args, "--network")).toBe("fb-a");
    expect(valueAfter(args, "--tmpfs")).toContain("noexec");
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("host");
    expect(valueAfter(args, "--publish")).toBe("127.0.0.1::3000");
  });

  it("gives each tenant its own network and volume", () => {
    const a = buildRunArgs(spec("a")).join(" ");
    const b = buildRunArgs(spec("b")).join(" ");
    expect(a).toContain("--network fb-a");
    expect(a).toContain("/tmp/sandboxes/a/sandbox-1:/workspace:rw");
    expect(b).toContain("--network fb-b");
    expect(b).toContain("/tmp/sandboxes/b/sandbox-1:/workspace:rw");
    expect(a).not.toContain("/tmp/sandboxes/b");
  });
});

class FakeExecutor implements CommandExecutor {
  readonly calls: { command: string; args: readonly string[] }[] = [];
  respond: (args: readonly string[]) => ExecResult = () => ({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });

  async exec(
    command: string,
    args: readonly string[],
    _options: { readonly timeoutMs: number },
  ): Promise<ExecResult> {
    this.calls.push({ command, args });
    return this.respond(args);
  }
}

describe("docker CLI runtime", () => {
  it("creates an internal network when egress is disabled", async () => {
    const executor = new FakeExecutor();
    const runtime = new DockerCliRuntime(executor);
    await runtime.ensureNetwork("fb-x", true);
    expect(executor.calls[0]?.args).toEqual([
      "network",
      "create",
      "--internal",
      "fb-x",
    ]);
  });

  it("returns the container id and throws on failure", async () => {
    const executor = new FakeExecutor();
    executor.respond = () => ({ stdout: "abc123\n", stderr: "", exitCode: 0 });
    const runtime = new DockerCliRuntime(executor);
    await expect(runtime.runContainer(spec("a"))).resolves.toBe("abc123");

    executor.respond = () => ({
      stdout: "",
      stderr: "Cannot connect to the Docker daemon",
      exitCode: 1,
    });
    await expect(runtime.runContainer(spec("a"))).rejects.toThrow(
      /Could not start sandbox container/,
    );
  });

  it("runs exec with an explicit working directory", async () => {
    const executor = new FakeExecutor();
    const runtime = new DockerCliRuntime(executor);
    await runtime.execIn("abc", ["cat", "package.json"], {
      cwd: "/workspace/repo",
    });
    expect(executor.calls[0]?.args).toEqual([
      "exec",
      "--workdir",
      "/workspace/repo",
      "abc",
      "cat",
      "package.json",
    ]);
  });

  it("parses the published host port", async () => {
    const executor = new FakeExecutor();
    executor.respond = () => ({
      stdout: "127.0.0.1:49153\n",
      stderr: "",
      exitCode: 0,
    });
    const runtime = new DockerCliRuntime(executor);
    await expect(runtime.hostPort("abc", 3000)).resolves.toBe(49153);

    executor.respond = () => ({ stdout: "", stderr: "no port", exitCode: 1 });
    await expect(runtime.hostPort("abc", 3000)).resolves.toBeUndefined();
  });
});
