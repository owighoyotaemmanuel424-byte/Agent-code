import { createServer } from "node:http";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  exchangeCodeForToken,
  githubCallbackUrl,
  listRepositories,
} from "@freebuff/auth";
import type { GithubEndpoints } from "@freebuff/auth";

interface LocalServer {
  readonly origin: string;
  readonly requests: { method: string; url: string; body: string; headers: IncomingHttpHeaders }[];
  readonly close: () => Promise<void>;
}

const startServer = async (
  handler: (request: { body: string; headers: IncomingHttpHeaders }, response: ServerResponse) => void,
): Promise<LocalServer> => {
  const requests: LocalServer["requests"] = [];
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
      handler({ body, headers: request.headers }, response);
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

const endpoints = (origin: string): Partial<GithubEndpoints> => ({
  authorizeUrl: `${origin}/login/oauth/authorize`,
  tokenUrl: `${origin}/login/oauth/access_token`,
  apiBaseUrl: `${origin}/api`,
});

describe("GitHub OAuth", () => {
  it("builds a PKCE authorize URL with state and scopes", () => {
    const pkce = createPkcePair();
    expect(pkce.challenge).toBe(
      createHash("sha256").update(pkce.verifier).digest("base64url"),
    );
    const url = new URL(
      buildAuthorizeUrl(
        {
          clientId: "client-123",
          clientSecret: "secret",
          redirectUri: "http://localhost:3001/auth/github/callback",
          scopes: ["repo", "read:user"],
          endpoints: endpoints("https://example.test"),
        },
        { state: "state-abc", codeChallenge: pkce.challenge },
      ),
    );
    expect(url.origin).toBe("https://example.test");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("scope")).toBe("repo read:user");
    expect(createOAuthState()).not.toBe(createOAuthState());
    expect(githubCallbackUrl("http://localhost:3001/")).toBe(
      "http://localhost:3001/auth/github/callback",
    );
  });

  it("exchanges the code with the verifier and returns the token", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: "gho_test", scope: "repo", token_type: "bearer" }));
    });
    try {
      const result = await exchangeCodeForToken({
        config: {
          clientId: "client-123",
          clientSecret: "secret",
          redirectUri: "http://localhost/cb",
          endpoints: endpoints(server.origin),
        },
        code: "code-1",
        codeVerifier: "verifier-1",
      });
      expect(result.accessToken).toBe("gho_test");
      const sent = JSON.parse(server.requests[0]?.body ?? "{}") as Record<string, unknown>;
      expect(sent["code"]).toBe("code-1");
      expect(sent["code_verifier"]).toBe("verifier-1");
      expect(sent["client_secret"]).toBe("secret");
    } finally {
      await server.close();
    }
  });

  it("maps a GitHub error response to unauthorized", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: "bad_verification_code", error_description: "The code is invalid" }),
      );
    });
    try {
      await expect(
        exchangeCodeForToken({
          config: {
            clientId: "c",
            clientSecret: "s",
            redirectUri: "http://localhost/cb",
            endpoints: endpoints(server.origin),
          },
          code: "bad",
          codeVerifier: "v",
        }),
      ).rejects.toMatchObject({ code: "unauthorized" });
    } finally {
      await server.close();
    }
  });

  it("lists repositories with the bearer token", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify([
          {
            id: 7,
            full_name: "owner/repo",
            private: true,
            default_branch: "main",
            clone_url: "https://github.com/owner/repo.git",
            updated_at: "2026-11-19T00:00:00Z",
          },
        ]),
      );
    });
    try {
      const repos = await listRepositories({
        token: "gho_test",
        endpoints: endpoints(server.origin),
      });
      expect(repos).toEqual([
        {
          id: 7,
          fullName: "owner/repo",
          private: true,
          defaultBranch: "main",
          cloneUrl: "https://github.com/owner/repo.git",
          updatedAt: "2026-11-19T00:00:00Z",
        },
      ]);
      expect(server.requests[0]?.headers.authorization).toBe("Bearer gho_test");
      expect(server.requests[0]?.url).toContain("/api/user/repos");
    } finally {
      await server.close();
    }
  });

  it("rejects an unauthorized repository listing", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end("{}");
    });
    try {
      await expect(
        listRepositories({ token: "expired", endpoints: endpoints(server.origin) }),
      ).rejects.toMatchObject({ code: "unauthorized" });
    } finally {
      await server.close();
    }
  });
});
