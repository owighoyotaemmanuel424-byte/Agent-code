import { execFile } from "node:child_process";
import { defineTool } from "@freebuff/shared";
import { z } from "zod";
import { createTool } from "../registry";
import { ServiceUnavailableError } from "../errors";
import type { SearchMatch, SearchRequest, SearchRunner } from "./context";

const MAX_SEARCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESULTS = 50;

/** Ripgrep-backed search with a bounded result set and no shell. */
export class RipgrepSearchRunner implements SearchRunner {
  constructor(private readonly root: string) {}

  search(request: SearchRequest, signal: AbortSignal): Promise<SearchMatch[]> {
    const args = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-columns",
      "400",
      ...(request.glob === undefined ? [] : ["--glob", request.glob]),
      ...(request.fixedStrings === true ? ["--fixed-strings"] : []),
      "--",
      request.pattern,
      ".",
    ];

    return new Promise((resolvePromise, reject) => {
      execFile(
        "rg",
        args,
        {
          cwd: this.root,
          timeout: MAX_SEARCH_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          signal,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error !== null) {
            const code = (error as { readonly code?: number | string }).code;
            // ripgrep exits 1 when there are simply no matches.
            if (code === 1) {
              resolvePromise([]);
              return;
            }
            reject(error);
            return;
          }
          resolvePromise(parseMatches(stdout, request.maxResults ?? DEFAULT_MAX_RESULTS));
        },
      );
    });
  }
}

export const parseMatches = (
  stdout: string,
  maxResults: number,
): SearchMatch[] => {
  const matches: SearchMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (matches.length >= maxResults) {
      break;
    }
    const first = line.indexOf(":");
    const second = line.indexOf(":", first + 1);
    if (first <= 0 || second <= first) {
      continue;
    }
    const lineNumber = Number.parseInt(line.slice(first + 1, second), 10);
    if (Number.isNaN(lineNumber)) {
      continue;
    }
    matches.push({
      file: line.slice(0, first).replace(/^\.\//, ""),
      line: lineNumber,
      text: line.slice(second + 1),
    });
  }
  return matches;
};

export const searchCodeTool = createTool(
  defineTool({
    name: "search_code",
    kind: "search.ripgrep",
    description:
      "Search the workspace with ripgrep. Returns file, line number and line text.",
    parameters: z.object({
      pattern: z.string().min(1).max(500),
      glob: z.string().min(1).max(200).optional().describe("e.g. src/**/*.ts"),
      maxResults: z.number().int().min(1).max(100).optional(),
      fixedStrings: z.boolean().optional(),
    }),
    mutating: false,
    timeoutMs: MAX_SEARCH_TIMEOUT_MS,
  }),
  async (args, context) => {
    if (context.search === undefined) {
      throw new ServiceUnavailableError("Code search");
    }
    const matches = await context.search.search(args, context.signal);
    return { matches, count: matches.length };
  },
);
