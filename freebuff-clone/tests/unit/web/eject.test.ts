import { createServer } from "node:http";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { ejectToGitHub } from "../../../apps/web/src/eject";

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
}

const startGitHub = async (): Promise<{
  origin: string;
  requests: Recorded[];
  close: () => Promise<void>;
}> => {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        body,
        headers: request.headers,
      });
      const respond = (status: number, payload: unknown): void => {
        (response as ServerResponse).writeHead(status, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify(payload));
      };
      if (request.method === "POST" && request.url === "/user/repos") {
        respond(201, {
          full_name: "octo/demo-app",
          html_url: "https://github.com/octo/demo-app",
        });
        return;
      }
      if (request.method === "PUT" && request.url?.startsWith("/repos/octo/demo-app/contents/")) {
        respond(201, { content: { path: request.url } });
        return;
      }
      respond(404, { message: "not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

describe("eject to GitHub", () => {
  it("creates a private repository and pushes every file", async () => {
    const github = await startGitHub();
    try {
      const result = await ejectToGitHub({
        token: "ghp_".padEnd(24, "a"),
        name: "Demo App",
        description: "A demo",
        apiBaseUrl: github.origin,
        files: [
          { path: "index.html", content: Buffer.from("<h1>demo</h1>", "utf8") },
          { path: "app.js", content: Buffer.from("console.log(1);", "utf8") },
        ],
      });

      expect(result.repoUrl).toBe("https://github.com/octo/demo-app");
      expect(result.fullName).toBe("octo/demo-app");
      expect(result.filesPushed).toBe(2);

      const create = github.requests[0];
      expect(create?.url).toBe("/user/repos");
      const createBody = JSON.parse(create?.body ?? "{}") as Record<string, unknown>;
      expect(createBody["private"]).toBe(true);
      expect(createBody["name"]).toBe("demo-app");

      const contents = github.requests.filter((request) =>
        request.url.startsWith("/repos/octo/demo-app/contents/"),
      );
      expect(contents).toHaveLength(2);
      const html = contents.find((request) => request.url.endsWith("index.html"));
      const payload = JSON.parse(html?.body ?? "{}") as { content: string };
      expect(Buffer.from(payload.content, "base64").toString("utf8")).toBe(
        "<h1>demo</h1>",
      );
    } finally {
      await github.close();
    }
  });

  it("rejects a missing token before calling GitHub", async () => {
    await expect(
      ejectToGitHub({
        token: "short",
        name: "demo",
        files: [{ path: "index.html", content: Buffer.from("x") }],
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});
