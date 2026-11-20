import { AppError, nowIso, projectIdSchema, timestampSchema } from "@freebuff/shared";
import type { ProjectId } from "@freebuff/shared";
import { z } from "zod";
import { readTextFile, writeFileAtomic } from "./fs-utils";
import type { CliPaths } from "./paths";

export const projectEntrySchema = z.object({
  id: projectIdSchema,
  name: z.string().min(1).max(120),
  path: z.string().min(1),
  addedAt: timestampSchema,
});
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

export const cliConfigSchema = z.object({
  version: z.literal(1),
  projects: z.array(projectEntrySchema),
  defaultProjectId: projectIdSchema.optional(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  modelId: z.string().min(1).optional(),
});
export type CliConfig = z.infer<typeof cliConfigSchema>;

export const emptyConfig = (countryCode = "US"): CliConfig => ({
  version: 1,
  projects: [],
  countryCode,
});

export const loadConfig = async (paths: CliPaths): Promise<CliConfig> => {
  const text = await readTextFile(paths.configFile);
  if (text === undefined) {
    return emptyConfig();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new AppError({
      code: "validation_failed",
      message: `Config is not valid JSON: ${paths.configFile}`,
      cause: error,
    });
  }
  const result = cliConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError({
      code: "validation_failed",
      message: `Config is invalid: ${paths.configFile}`,
    });
  }
  return result.data;
};

export const saveConfig = async (
  paths: CliPaths,
  config: CliConfig,
): Promise<void> => {
  await writeFileAtomic(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
};

export const touchProject = (
  project: ProjectEntry,
): ProjectEntry => ({
  ...project,
  addedAt: project.addedAt.length > 0 ? project.addedAt : nowIso(),
});

export const findProjectById = (
  config: CliConfig,
  id: ProjectId,
): ProjectEntry | undefined =>
  config.projects.find((project) => String(project.id) === String(id));
