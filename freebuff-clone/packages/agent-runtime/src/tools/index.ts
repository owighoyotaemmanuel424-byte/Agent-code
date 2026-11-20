import type { RegisteredTool } from "../registry";
import type { SubagentSpawner } from "./delegate";
import { createDelegationTool, codeMapQueryTool } from "./delegate";
import {
  editFileTool,
  patchFilesTool,
  readFileTool,
  writeFileTool,
} from "./files";
import { searchCodeTool } from "./search";
import { runCommandTool } from "./terminal";
import { fetchUrlTool } from "./web";

export interface DefaultToolOptions {
  readonly delegation?: {
    readonly spawn: SubagentSpawner;
    readonly maxParallel: number;
  };
}

/** The full tool set offered to a primary agent. */
export const createDefaultTools = (
  options: DefaultToolOptions = {},
): RegisteredTool[] => [
  readFileTool,
  writeFileTool,
  editFileTool,
  patchFilesTool,
  searchCodeTool,
  runCommandTool,
  fetchUrlTool,
  codeMapQueryTool,
  ...(options.delegation === undefined
    ? []
    : [createDelegationTool(options.delegation)]),
];
