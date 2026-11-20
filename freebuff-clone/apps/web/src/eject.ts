import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@freebuff/shared";
import { createTarGz } from "./tar";
import type { BundleFile } from "./tar";
import type { AppRecord } from "./store";

/** Recursively reads a generated app's source tree, sorted for determinism. */
export const readSourceFiles = async (
  root: string,
  appId: string,
): Promise<BundleFile[]> => {
  const directory = join(root, "apps", appId, "source");
  const walk = async (current: string, prefix: string): Promise<BundleFile[]> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const files: BundleFile[] = [];
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        files.push(...(await walk(absolute, path)));
      } else if (entry.isFile()) {
        files.push({ path, content: await readFile(absolute) });
      }
    }
    return files;
  };
  return walk(directory, "");
};

export const createEjectBundle = (
  app: AppRecord,
  files: readonly BundleFile[],
): Buffer => {
  const manifest: BundleFile = {
    path: "freebuff.app.json",
    content: Buffer.from(JSON.stringify(app.spec, null, 2), "utf8"),
  };
  const hasManifest = files.some((file) => file.path === "freebuff.app.json");
  return createTarGz(
    hasManifest ? files : [...files, manifest],
    { mtimeSeconds: Math.floor(Date.parse(app.createdAt) / 1000) || 0 },
  );
};

export interface GitHubEjectOptions {
  readonly token: string;
  readonly name: string;
  readonly description?: string;
  readonly files: readonly BundleFile[];
  readonly fetchImpl?: typeof fetch;
  readonly apiBaseUrl?: string;
}

export interface GitHubEjectResult {
  readonly repoUrl: string;
  readonly fullName: string;
  readonly filesPushed: number;
}

const safeRepoName = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  if (cleaned.length === 0) {
    throw new AppError({
      code: "validation_failed",
      message: "Repository name is not usable",
    });
  }
  return cleaned;
};

/**
 * Ejects the generated tree to a new private GitHub repository using the REST
 * API, so the platform does not need a git binary or shell access. The token is
 * caller-supplied and never stored.
 */
export const ejectToGitHub = async (
  options: GitHubEjectOptions,
): Promise<GitHubEjectResult> => {
  if (options.token.trim().length < 10) {
    throw new AppError({
      code: "unauthorized",
      message: "A GitHub access token is required",
    });
  }
  if (options.files.length === 0) {
    throw new AppError({ code: "not_found", message: "No source files to eject" });
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
  const call = async (
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new AppError({
        code: "unauthorized",
        message: "GitHub rejected the access token",
      });
    }
    if (!response.ok) {
      throw new AppError({
        code: "provider_error",
        message: `GitHub returned HTTP ${String(response.status)} while ejecting`,
        retryable: response.status >= 500,
      });
    }
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  };

  const created = await call("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: safeRepoName(options.name),
      description: options.description ?? "Generated with freebuff",
      private: true,
      auto_init: false,
    }),
  });
  const fullName = String(created["full_name"] ?? "");
  const repoUrl = String(created["html_url"] ?? "");
  if (fullName.length === 0 || repoUrl.length === 0) {
    throw new AppError({
      code: "provider_error",
      message: "GitHub did not return the new repository",
    });
  }

  let filesPushed = 0;
  for (const file of options.files.slice(0, 50)) {
    await call(`/repos/${fullName}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Add ${file.path}`,
        content: file.content.toString("base64"),
      }),
    });
    filesPushed += 1;
  }

  return { repoUrl, fullName, filesPushed };
};
