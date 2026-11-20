import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Atomic write: a partial file is never observable, even if the process dies
 * mid-write. Credentials and state files use 0600.
 */
export const writeFileAtomic = async (
  filePath: string,
  content: string,
  mode = 0o600,
): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, filePath);
};

const isMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as NodeJS.ErrnoException).code === "ENOENT";

export const readTextFile = async (
  filePath: string,
): Promise<string | undefined> => {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
};
