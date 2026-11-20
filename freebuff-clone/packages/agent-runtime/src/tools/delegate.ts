import { defineTool } from "@freebuff/shared";
import { z } from "zod";
import { createTool } from "../registry";
import { runParallelSubagents } from "../subagents";
import type { SubagentSpawnResult } from "../subagents";
import { ServiceUnavailableError, ToolInputError } from "../errors";

export type SubagentSpawner = (
  task: string,
  index: number,
) => Promise<SubagentSpawnResult>;

export interface DelegationToolOptions {
  readonly spawn: SubagentSpawner;
  readonly maxParallel: number;
}

/**
 * Delegation is a tool like any other, so the parent model decides when to fan
 * out. The runtime bounds concurrency and preserves task order.
 */
export const createDelegationTool = (options: DelegationToolOptions) =>
  createTool(
    defineTool({
      name: "delegate_tasks",
      kind: "subagent.delegate",
      description:
        "Delegate independent subtasks to parallel subagents. Each task must be self-contained.",
      parameters: z.object({
        tasks: z.array(z.string().min(1).max(4000)).min(1).max(8),
      }),
      mutating: false,
      timeoutMs: 600_000,
    }),
    async (args, context) => {
      const outcomes = await runParallelSubagents(args.tasks, {
        maxParallel: options.maxParallel,
        signal: context.signal,
        spawn: options.spawn,
      });
      return { subagents: outcomes };
    },
  );

const codeMapQueries = [
  "files",
  "outline",
  "definitions",
  "references",
  "dependencies",
  "dependents",
  "search",
  "stats",
] as const;

export const codeMapQueryTool = createTool(
  defineTool({
    name: "query_code_map",
    kind: "code_map.query",
    description:
      "Query the repository symbol graph: outline a file, find definitions, references or import edges.",
    parameters: z.object({
      query: z.enum(codeMapQueries),
      target: z.string().min(1).max(1024).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    mutating: false,
    timeoutMs: 15_000,
  }),
  async (args, context) => {
    const codeMap = context.codeMap;
    if (codeMap === undefined) {
      throw new ServiceUnavailableError("Code map");
    }
    if (args.query !== "files" && args.query !== "stats" && args.target === undefined) {
      throw new ToolInputError(`query "${args.query}" requires a target`);
    }
    switch (args.query) {
      case "files":
        return { files: codeMap.files() };
      case "stats":
        return codeMap.stats();
      case "outline":
        return { symbols: codeMap.outline(args.target ?? "") };
      case "definitions":
        return { symbols: codeMap.definitions(args.target ?? "") };
      case "references":
        return { references: codeMap.references(args.target ?? "") };
      case "dependencies":
        return { edges: codeMap.dependencies(args.target ?? "") };
      case "dependents":
        return { edges: codeMap.dependents(args.target ?? "") };
      case "search":
        return { symbols: codeMap.search(args.target ?? "", args.limit ?? 20) };
    }
  },
);
