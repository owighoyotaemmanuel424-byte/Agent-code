import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Stack detection: decide how to install and serve a cloned repository. */
export interface StackFileReader {
  read(path: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
}

export const nodeFileReader = (root: string): StackFileReader => ({
  read: async (path) => {
    try {
      return await readFile(join(root, path), "utf8");
    } catch {
      return undefined;
    }
  },
  exists: async (path) => {
    try {
      await stat(join(root, path));
      return true;
    } catch {
      return false;
    }
  },
});

export interface DetectedStack {
  readonly name: string;
  readonly supported: boolean;
  readonly reason?: string;
  readonly install: readonly string[];
  readonly dev: readonly string[];
  readonly port: number;
}

const PACKAGE_MANAGERS = [
  { lockfile: "bun.lock", manager: "bun", install: ["bun", "install"] },
  { lockfile: "bun.lockb", manager: "bun", install: ["bun", "install"] },
  { lockfile: "pnpm-lock.yaml", manager: "pnpm", install: ["pnpm", "install"] },
  { lockfile: "yarn.lock", manager: "yarn", install: ["yarn", "install"] },
  {
    lockfile: "package-lock.json",
    manager: "npm",
    install: ["npm", "install", "--no-audit", "--no-fund"],
  },
] as const;

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

const parseManifest = (raw: string | undefined): PackageManifest | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as PackageManifest)
      : undefined;
  } catch {
    return undefined;
  }
};

const unsupported = (reason: string): DetectedStack => ({
  name: "unknown",
  supported: false,
  reason,
  install: [],
  dev: [],
  port: 0,
});

const hasDependency = (
  manifest: PackageManifest,
  name: string,
): boolean =>
  manifest.dependencies?.[name] !== undefined ||
  manifest.devDependencies?.[name] !== undefined;

export const detectStack = async (
  files: StackFileReader,
): Promise<DetectedStack> => {
  const manifestRaw = await files.read("package.json");
  if (manifestRaw !== undefined) {
    const manifest = parseManifest(manifestRaw);
    if (manifest === undefined) {
      return unsupported("package.json could not be parsed");
    }
    const script = manifest.scripts?.["dev"] ?? manifest.scripts?.["start"];
    if (script === undefined) {
      return unsupported("package.json has neither a dev nor a start script");
    }

    let manager: string = "npm";
    let install: readonly string[] = [
      "npm",
      "install",
      "--no-audit",
      "--no-fund",
    ];
    for (const candidate of PACKAGE_MANAGERS) {
      if (await files.exists(candidate.lockfile)) {
        manager = candidate.manager;
        install = candidate.install;
        break;
      }
    }

    const isNext = hasDependency(manifest, "next");
    const isVite = hasDependency(manifest, "vite");
    const runner = manager === "npm" ? "npm" : manager;
    const runArgs =
      manager === "npm"
        ? ["run", "dev"]
        : ["run", "dev"];

    if (isVite) {
      return {
        name: "vite",
        supported: true,
        install,
        dev: [runner, ...runArgs, "--", "--host", "0.0.0.0", "--port", "{port}", "--strictPort"],
        port: 5173,
      };
    }
    if (isNext) {
      return {
        name: "next",
        supported: true,
        install,
        dev: [runner, ...runArgs, "--", "-p", "{port}"],
        port: 3000,
      };
    }
    return {
      name: "node",
      supported: true,
      install,
      dev: [runner, ...runArgs],
      port: 3000,
    };
  }

  if (await files.exists("index.html")) {
    return {
      name: "static",
      supported: true,
      install: [],
      dev: ["python3", "-m", "http.server", "{port}", "--bind", "0.0.0.0"],
      port: 8000,
    };
  }

  if (
    (await files.exists("requirements.txt")) &&
    (await files.exists("manage.py"))
  ) {
    return {
      name: "django",
      supported: true,
      install: ["python3", "-m", "pip", "install", "--user", "-r", "requirements.txt"],
      dev: ["python3", "manage.py", "runserver", "0.0.0.0:{port}"],
      port: 8000,
    };
  }

  return unsupported(
    "No supported stack detected (expected package.json with dev/start, index.html, or a Django project)",
  );
};

/** Substitutes the allocated preview port into detected commands. */
export const withPort = (
  command: readonly string[],
  port: number,
): string[] =>
  command.map((part) => part.replace("{port}", String(port)));
