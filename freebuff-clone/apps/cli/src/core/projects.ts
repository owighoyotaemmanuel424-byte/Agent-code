import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { AppError, newId, nowIso, projectIdSchema } from "@freebuff/shared";
import { loadConfig, saveConfig } from "./config";
import type { CliConfig, ProjectEntry } from "./config";
import type { CliPaths } from "./paths";

/**
 * Why a registered folder cannot be opened, in one short phrase plus an inline
 * recovery path. Never throws: the picker renders the reason in text-muted.
 */
export interface ProjectInspection {
  readonly projectId: string;
  readonly path: string;
  readonly ok: boolean;
  readonly branch?: string;
  readonly reason?: string;
  readonly recovery?: string;
}

const gitBranch = async (path: string): Promise<string> => {
  const head = await readFile(join(path, ".git", "HEAD"), "utf8").catch(() => undefined);
  const trimmed = head?.trim() ?? "";
  const prefix = "ref: refs/heads/";
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : "detached";
};

export const inspectProject = async (
  project: ProjectEntry,
): Promise<ProjectInspection> => {
  const base = { projectId: String(project.id), path: project.path };
  const info = await stat(project.path).catch(() => undefined);
  if (info === undefined) {
    return {
      ...base,
      ok: false,
      reason: "folder is missing",
      recovery: "Re-add it with freebuff projects add <path>.",
    };
  }
  if (!info.isDirectory()) {
    return {
      ...base,
      ok: false,
      reason: "not a directory",
      recovery: "Point the entry at a folder: freebuff projects add <path>.",
    };
  }
  const entries = await readdir(project.path).catch(() => undefined);
  if (entries === undefined) {
    return {
      ...base,
      ok: false,
      reason: "permission denied",
      recovery: "Fix the folder permissions, or choose another project.",
    };
  }
  if (entries.length === 0) {
    return {
      ...base,
      ok: false,
      reason: "empty folder",
      recovery: "Run git init here and add files, then reopen.",
    };
  }
  const git = await stat(join(project.path, ".git")).catch(() => undefined);
  if (git === undefined) {
    return {
      ...base,
      ok: false,
      reason: "not a git repository",
      recovery: "Run git init here to track changes, then reopen.",
    };
  }
  return { ...base, ok: true, branch: await gitBranch(project.path) };
};

export interface AddProjectInput {
  readonly path: string;
  readonly name?: string;
}

export interface AddProjectResult {
  readonly config: CliConfig;
  readonly project: ProjectEntry;
  readonly created: boolean;
}

/** Registering the same absolute path twice is idempotent. */
export const addProject = async (
  paths: CliPaths,
  input: AddProjectInput,
): Promise<AddProjectResult> => {
  const absolute = resolve(input.path);
  const info = await stat(absolute).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new AppError({
      code: "not_found",
      message: `Not a directory: ${absolute}`,
    });
  }

  const config = await loadConfig(paths);
  const existing = config.projects.find((project) => resolve(project.path) === absolute);
  if (existing !== undefined) {
    return { config, project: existing, created: false };
  }

  const project: ProjectEntry = {
    id: projectIdSchema.parse(newId()),
    name: input.name?.trim() ?? basename(absolute),
    path: absolute,
    addedAt: nowIso(),
  };
  const next: CliConfig = {
    ...config,
    projects: [...config.projects, project],
    defaultProjectId: config.defaultProjectId ?? project.id,
  };
  await saveConfig(paths, next);
  return { config: next, project, created: true };
};

/** Matches by id, exact name, then path suffix, so `--project api` works. */
export const resolveProject = (
  config: CliConfig,
  selector: string,
): ProjectEntry | undefined => {
  const needle = selector.trim();
  if (needle.length === 0) {
    return undefined;
  }
  return (
    config.projects.find((project) => String(project.id) === needle) ??
    config.projects.find((project) => project.name === needle) ??
    config.projects.find(
      (project) => project.name.toLowerCase() === needle.toLowerCase(),
    ) ??
    config.projects.find((project) => project.path.endsWith(needle))
  );
};

export interface ProjectPicker {
  (
    projects: readonly ProjectEntry[],
    selectedIndex: number,
  ): Promise<ProjectEntry | undefined>;
}

export const setDefaultProject = async (
  paths: CliPaths,
  selector: string,
): Promise<ProjectEntry> => {
  const config = await loadConfig(paths);
  const project = resolveProject(config, selector);
  if (project === undefined) {
    throw new AppError({
      code: "not_found",
      message: `No project matches "${selector}"`,
    });
  }
  await saveConfig(paths, { ...config, defaultProjectId: project.id });
  return project;
};

/**
 * Chooses a project for a run: explicit selector, then the saved default, then
 * an interactive picker when one is supplied.
 */
export const pickProject = async (
  config: CliConfig,
  options: {
    readonly selector?: string;
    readonly picker?: ProjectPicker;
    readonly remember?: (project: ProjectEntry, config: CliConfig) => Promise<void>;
  } = {},
): Promise<ProjectEntry> => {
  if (options.selector !== undefined) {
    const match = resolveProject(config, options.selector);
    if (match === undefined) {
      throw new AppError({
        code: "not_found",
        message: `No project matches "${options.selector}"`,
      });
    }
    return match;
  }

  if (config.defaultProjectId !== undefined) {
    const saved = config.projects.find(
      (project) => String(project.id) === String(config.defaultProjectId),
    );
    if (saved !== undefined) {
      return saved;
    }
  }

  if (config.projects.length === 0) {
    throw new AppError({
      code: "not_found",
      message: "No projects yet. Add one with: freebuff projects add <path>",
    });
  }
  if (config.projects.length === 1) {
    const only = config.projects[0];
    if (only !== undefined) {
      return only;
    }
  }
  if (options.picker === undefined) {
    throw new AppError({
      code: "validation_failed",
      message: "Choose a project with --project <id|name|path>",
    });
  }

  const picked = await options.picker(config.projects, 0);
  if (picked === undefined) {
    throw new AppError({ code: "cancelled", message: "No project selected" });
  }
  await options.remember?.(picked, config);
  return picked;
};
