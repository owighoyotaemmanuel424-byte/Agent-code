import { createHash, randomBytes } from "node:crypto";
import { AppError } from "@freebuff/shared";
import { z } from "zod";

/** GitHub OAuth 2.0 (authorization code + PKCE) and repository listing. */

export interface GithubEndpoints {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly apiBaseUrl: string;
}

const GITHUB_ENDPOINTS: GithubEndpoints = {
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  apiBaseUrl: "https://api.github.com",
};

export interface GithubOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes?: readonly string[];
  readonly endpoints?: Partial<GithubEndpoints>;
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export const createPkcePair = (): PkcePair => {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
};

/** Opaque CSRF state for the OAuth round trip. */
export const createOAuthState = (): string => randomBytes(24).toString("base64url");

const endpointsFor = (config: GithubOAuthConfig): GithubEndpoints => ({
  ...GITHUB_ENDPOINTS,
  ...config.endpoints,
});

export const buildAuthorizeUrl = (
  config: GithubOAuthConfig,
  options: { readonly state: string; readonly codeChallenge: string },
): string => {
  const endpoints = endpointsFor(config);
  const url = new URL(endpoints.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", (config.scopes ?? ["repo", "read:user"]).join(" "));
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "true");
  return url.toString();
};

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export interface GithubTokenResult {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly scope: string;
}

export const exchangeCodeForToken = async (options: {
  readonly config: GithubOAuthConfig;
  readonly code: string;
  readonly codeVerifier: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<GithubTokenResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoints = endpointsFor(options.config);
  const response = await fetchImpl(endpoints.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: options.config.clientId,
      client_secret: options.config.clientSecret,
      code: options.code,
      redirect_uri: options.config.redirectUri,
      code_verifier: options.codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new AppError({
      code: "provider_error",
      message: `GitHub token exchange failed with HTTP ${String(response.status)}`,
      retryable: response.status >= 500,
    });
  }
  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppError({
      code: "provider_error",
      message: "GitHub returned an unexpected token response",
    });
  }
  if (
    parsed.data.error !== undefined ||
    parsed.data.access_token === undefined
  ) {
    throw new AppError({
      code: "unauthorized",
      message:
        parsed.data.error_description ??
        parsed.data.error ??
        "GitHub did not authorize the request",
    });
  }
  return {
    accessToken: parsed.data.access_token,
    tokenType: parsed.data.token_type ?? "bearer",
    scope: parsed.data.scope ?? "",
  };
};

const repositorySchema = z.object({
  id: z.number(),
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string(),
  clone_url: z.string(),
  updated_at: z.string().optional(),
});

const repositoriesSchema = z.array(repositorySchema);

export interface GithubRepository {
  readonly id: number;
  readonly fullName: string;
  readonly private: boolean;
  readonly defaultBranch: string;
  readonly cloneUrl: string;
  readonly updatedAt?: string;
}

export const listRepositories = async (options: {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly perPage?: number;
  readonly endpoints?: Partial<GithubEndpoints>;
}): Promise<GithubRepository[]> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoints = { ...GITHUB_ENDPOINTS, ...options.endpoints };
  const url = new URL(`${endpoints.apiBaseUrl}/user/repos`);
  url.searchParams.set("per_page", String(options.perPage ?? 100));
  url.searchParams.set("sort", "updated");
  url.searchParams.set("affiliation", "owner,collaborator,organization_member");

  const response = await fetchImpl(url.toString(), {
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401) {
    throw new AppError({
      code: "unauthorized",
      message: "GitHub rejected the access token",
    });
  }
  if (!response.ok) {
    throw new AppError({
      code: "provider_error",
      message: `GitHub repository listing failed with HTTP ${String(response.status)}`,
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  const parsed = repositoriesSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppError({
      code: "provider_error",
      message: "GitHub returned an unexpected repository list",
    });
  }
  return parsed.data.map((repo) => ({
    id: repo.id,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    cloneUrl: repo.clone_url,
    ...(repo.updated_at === undefined ? {} : { updatedAt: repo.updated_at }),
  }));
};

/** Hosted OAuth needs a reachable callback; local mode uses a fixed origin. */
export const githubCallbackUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/auth/github/callback`;
