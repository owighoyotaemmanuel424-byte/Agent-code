import { AppError, timestampSchema, userIdSchema } from "@freebuff/shared";
import type { UserId } from "@freebuff/shared";
import { z } from "zod";
import { readTextFile, writeFileAtomic } from "./fs-utils";
import type { CliPaths } from "./paths";

export const storedCredentialsSchema = z.object({
  token: z.string().min(1),
  userId: userIdSchema,
  email: z.string().min(1),
  savedAt: timestampSchema,
});
export type StoredCredentials = z.infer<typeof storedCredentialsSchema>;

export const loadCredentials = async (
  paths: CliPaths,
): Promise<StoredCredentials | undefined> => {
  const text = await readTextFile(paths.credentialsFile);
  if (text === undefined) {
    return undefined;
  }
  const parsed = storedCredentialsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new AppError({
      code: "validation_failed",
      message: "Saved credentials are invalid. Run: freebuff auth logout",
    });
  }
  return parsed.data;
};

export const requireCredentials = async (
  paths: CliPaths,
): Promise<StoredCredentials> => {
  const credentials = await loadCredentials(paths);
  if (credentials === undefined) {
    throw new AppError({
      code: "unauthorized",
      message: "Not signed in. Run: freebuff auth login --email you@example.com",
    });
  }
  return credentials;
};

export const saveCredentials = async (
  paths: CliPaths,
  input: { readonly token: string; readonly userId: UserId; readonly email: string },
): Promise<StoredCredentials> => {
  const credentials: StoredCredentials = {
    token: input.token,
    userId: input.userId,
    email: input.email,
    savedAt: new Date().toISOString(),
  };
  await writeFileAtomic(
    paths.credentialsFile,
    `${JSON.stringify(credentials, null, 2)}\n`,
  );
  return credentials;
};

export const clearCredentials = async (paths: CliPaths): Promise<void> => {
  await writeFileAtomic(paths.credentialsFile, "");
};
