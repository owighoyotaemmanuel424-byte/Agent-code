import { describe, expect, it } from "vitest";
import { detectStack, nodeFileReader, withPort } from "@freebuff/sandbox-orchestrator";
import { createFixtureRepo } from "../../support/fixture-repo";

const detect = async (files: Record<string, string>) => {
  const repo = await createFixtureRepo(files);
  try {
    return await detectStack(nodeFileReader(repo.root));
  } finally {
    await repo.cleanup();
  }
};

describe("stack detection", () => {
  it("detects a bun + vite project and forces the preview port", async () => {
    const stack = await detect({
      "package.json": JSON.stringify({
        scripts: { dev: "vite" },
        devDependencies: { vite: "^5.0.0" },
      }),
      "bun.lock": "",
    });
    expect(stack.name).toBe("vite");
    expect(stack.supported).toBe(true);
    expect(stack.install).toEqual(["bun", "install"]);
    expect(stack.dev[0]).toBe("bun");
    expect(stack.dev).toContain("--port");
    expect(stack.dev).toContain("{port}");
    expect(withPort(stack.dev, 3000)).toContain("3000");
  });

  it("detects an npm + next project", async () => {
    const stack = await detect({
      "package.json": JSON.stringify({
        scripts: { dev: "next dev" },
        dependencies: { next: "^15.0.0" },
      }),
      "package-lock.json": "{}",
    });
    expect(stack.name).toBe("next");
    expect(stack.install[0]).toBe("npm");
    expect(stack.dev).toEqual(["npm", "run", "dev", "--", "-p", "{port}"]);
    expect(stack.port).toBe(3000);
  });

  it("detects a static site", async () => {
    const stack = await detect({ "index.html": "<h1>hi</h1>" });
    expect(stack.name).toBe("static");
    expect(stack.dev).toEqual([
      "python3",
      "-m",
      "http.server",
      "{port}",
      "--bind",
      "0.0.0.0",
    ]);
  });

  it("reports an unsupported project with a reason", async () => {
    const empty = await detect({});
    expect(empty.supported).toBe(false);
    expect(empty.reason).toMatch(/No supported stack/);

    const noScript = await detect({
      "package.json": JSON.stringify({ name: "lib", dependencies: {} }),
    });
    expect(noScript.supported).toBe(false);
    expect(noScript.reason).toMatch(/neither a dev nor a start script/);
  });

  it("rejects a malformed package.json", async () => {
    const stack = await detect({ "package.json": "{not json" });
    expect(stack.supported).toBe(false);
    expect(stack.reason).toMatch(/could not be parsed/);
  });
});
