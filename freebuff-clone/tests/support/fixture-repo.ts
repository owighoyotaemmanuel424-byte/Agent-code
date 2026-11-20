import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixtureRepo {
  readonly root: string;
  readonly cleanup: () => Promise<void>;
}

export const createFixtureRepo = async (
  files: Readonly<Record<string, string>> = {},
): Promise<FixtureRepo> => {
  const root = await mkdtemp(join(tmpdir(), "freebuff-fixture-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
};

export const readFixture = async (
  root: string,
  relativePath: string,
): Promise<string> => readFile(join(root, relativePath), "utf8");
