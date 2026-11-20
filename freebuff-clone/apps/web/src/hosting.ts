import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { AppError } from "@freebuff/shared";

export interface PublishFile {
  readonly path: string;
  readonly content: Buffer;
}

export interface PublishInput {
  readonly appId: string;
  readonly slug: string;
  readonly files: readonly PublishFile[];
}

export interface PublishResult {
  readonly urlPath: string;
}

/**
 * Hosting boundary. The local adapter writes an immutable build directory that
 * the web server serves; a CDN/object-store adapter implements the same
 * interface without touching the builder.
 */
export interface HostingAdapter {
  publish(input: PublishInput): Promise<PublishResult>;
  remove(appId: string): Promise<void>;
}

const safeRelativePath = (path: string): string => {
  const normalized = path.replace(/^\/+/, "");
  const resolved = resolve("/", normalized);
  if (relative("/", resolved).startsWith("..") || normalized.includes("\0")) {
    throw new AppError({
      code: "validation_failed",
      message: `Refusing to publish unsafe path "${path}"`,
    });
  }
  return normalized;
};

export class LocalHostingAdapter implements HostingAdapter {
  private readonly root: string;

  constructor(options: { readonly root: string }) {
    this.root = options.root;
  }

  private directory(appId: string): string {
    return join(this.root, "apps", appId, "build");
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const directory = this.directory(input.appId);
    await rm(directory, { recursive: true, force: true });
    for (const file of input.files) {
      const target = join(directory, safeRelativePath(file.path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    return { urlPath: `/s/${input.slug}/` };
  }

  async remove(appId: string): Promise<void> {
    await rm(this.directory(appId), { recursive: true, force: true });
  }
}
