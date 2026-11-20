import { defineTool } from "@freebuff/shared";
import { z } from "zod";
import { ToolInputError } from "../errors";
import { createTool } from "../registry";

const countOccurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
};

const MAX_FILE_BYTES = 1_000_000;

export const readFileTool = createTool(
  defineTool({
    name: "read_file",
    kind: "files.read",
    description:
      "Read a UTF-8 text file from the workspace. Optionally return a line window.",
    parameters: z.object({
      path: z.string().min(1).max(4096).describe("Workspace-relative file path"),
      offset: z.number().int().min(1).optional().describe("First line, 1-based"),
      limit: z.number().int().min(1).max(2000).optional().describe("Line count"),
    }),
    mutating: false,
    timeoutMs: 10_000,
  }),
  async (args, context) => {
    const content = await context.workspace.readFile(args.path);
    const lines = content.split("\n");
    const offset = args.offset ?? 1;
    const limit = args.limit ?? 2000;
    const start = Math.min(offset - 1, lines.length);
    const window = lines.slice(start, start + limit);
    return {
      path: args.path,
      totalLines: lines.length,
      offset,
      content: window.join("\n"),
      truncated: start + window.length < lines.length,
    };
  },
);

export const writeFileTool = createTool(
  defineTool({
    name: "write_file",
    kind: "files.write",
    description:
      "Create or replace a file. Parent directories are created as needed.",
    parameters: z.object({
      path: z.string().min(1).max(4096).describe("Workspace-relative file path"),
      content: z.string().max(MAX_FILE_BYTES),
    }),
    mutating: true,
    timeoutMs: 10_000,
  }),
  async (args, context) => {
    await context.workspace.writeFile(args.path, args.content);
    return {
      path: args.path,
      bytes: Buffer.byteLength(args.content, "utf8"),
    };
  },
);

export const editFileTool = createTool(
  defineTool({
    name: "edit_file",
    kind: "files.edit",
    description:
      "Replace an exact string in one file. Fails if the string is missing or ambiguous.",
    parameters: z.object({
      path: z.string().min(1).max(4096),
      oldString: z.string().min(1).max(MAX_FILE_BYTES),
      newString: z.string().max(MAX_FILE_BYTES),
      allowMultiple: z.boolean().optional(),
    }),
    mutating: true,
    timeoutMs: 10_000,
  }),
  async (args, context) => {
    if (args.oldString === args.newString) {
      throw new ToolInputError("oldString and newString are identical");
    }
    const content = await context.workspace.readFile(args.path);
    const occurrences = countOccurrences(content, args.oldString);
    if (occurrences === 0) {
      throw new ToolInputError(
        `oldString was not found in ${args.path}. Read the file and copy the exact text.`,
      );
    }
    if (occurrences > 1 && args.allowMultiple !== true) {
      throw new ToolInputError(
        `oldString matches ${String(occurrences)} times in ${args.path}. Pass allowMultiple or use a longer unique string.`,
      );
    }
    const updated =
      args.allowMultiple === true
        ? content.split(args.oldString).join(args.newString)
        : content.replace(args.oldString, args.newString);
    await context.workspace.writeFile(args.path, updated);
    return { path: args.path, replacements: occurrences };
  },
);

export const patchFilesTool = createTool(
  defineTool({
    name: "patch_files",
    kind: "files.patch",
    description:
      "Apply coordinated exact-string edits across several files atomically. Nothing is written if any patch fails.",
    parameters: z.object({
      patches: z
        .array(
          z.object({
            path: z.string().min(1).max(4096),
            oldString: z.string().min(1),
            newString: z.string(),
          }),
        )
        .min(1)
        .max(20),
    }),
    mutating: true,
    timeoutMs: 20_000,
  }),
  async (args, context) => {
    const contents = new Map<string, string>();
    const pendingWrites = new Map<string, string>();

    for (const patch of args.patches) {
      const current =
        contents.get(patch.path) ??
        pendingWrites.get(patch.path) ??
        (await context.workspace.readFile(patch.path));
      contents.set(patch.path, current);
      const occurrences = countOccurrences(current, patch.oldString);
      if (occurrences === 0) {
        throw new ToolInputError(
          `Patch for ${patch.path} did not match. Nothing was written.`,
        );
      }
      pendingWrites.set(
        patch.path,
        current.split(patch.oldString).join(patch.newString),
      );
    }

    for (const [path, content] of pendingWrites) {
      await context.workspace.writeFile(path, content);
    }

    return {
      patchesApplied: args.patches.length,
      filesChanged: [...pendingWrites.keys()],
    };
  },
);
