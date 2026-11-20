import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { AppError } from "@freebuff/shared";

export interface WorkspaceEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
}

/**
 * Every filesystem tool talks to this interface. Paths are always relative to
 * the workspace root and are rejected if they escape it.
 */
export interface Workspace {
  readonly root: string;
  absolutePath(relativePath: string): string;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  list(relativePath: string): Promise<WorkspaceEntry[]>;
}

const notFound = (relativePath: string, cause?: unknown): AppError =>
  new AppError({
    code: "not_found",
    message: `File not found: ${relativePath}`,
    cause,
  });

export class FileSystemWorkspace implements Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  absolutePath(relativePath: string): string {
    if (relativePath.includes("\0")) {
      throw new AppError({
        code: "validation_failed",
        message: "Path contains a null byte",
      });
    }
    if (isAbsolute(relativePath)) {
      throw new AppError({
        code: "forbidden",
        message: `Absolute paths are not permitted: ${relativePath}`,
      });
    }
    const absolute = resolve(this.root, relativePath);
    const rel = relative(this.root, absolute);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new AppError({
        code: "forbidden",
        message: `Path escapes the workspace: ${relativePath}`,
      });
    }
    return absolute;
  }

  async readFile(relativePath: string): Promise<string> {
    // Confinement is resolved before the read so a forbidden path is never
    // reported as a missing file.
    const absolute = this.absolutePath(relativePath);
    try {
      return await readFile(absolute, "utf8");
    } catch (error) {
      throw notFound(relativePath, error);
    }
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const absolute = this.absolutePath(relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.absolutePath(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async list(relativePath: string): Promise<WorkspaceEntry[]> {
    const entries = await readdir(this.absolutePath(relativePath), {
      withFileTypes: true,
    });
    return entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" : "file",
    }));
  }
}
