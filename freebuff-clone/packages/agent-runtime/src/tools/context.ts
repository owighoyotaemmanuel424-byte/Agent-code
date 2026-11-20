import type { CodeMapQuery } from "@freebuff/code-map";
import type { Workspace } from "../workspace";

export interface SearchMatch {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchRequest {
  readonly pattern: string;
  readonly glob?: string;
  readonly maxResults?: number;
  readonly fixedStrings?: boolean;
}

export interface SearchRunner {
  search(request: SearchRequest, signal: AbortSignal): Promise<SearchMatch[]>;
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly durationMs: number;
}

/** Runs argv directly — never through a shell — so agent stdio is untouched. */
export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: CommandOptions,
  ): Promise<CommandResult>;
}

export interface WebFetchResult {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface WebFetcher {
  fetch(
    url: string,
    options: { readonly maxBytes: number; readonly timeoutMs: number; readonly signal: AbortSignal },
  ): Promise<WebFetchResult>;
}

/** The services every tool invocation receives. */
export interface ToolExecutionContext {
  readonly workspace: Workspace;
  readonly signal: AbortSignal;
  readonly search?: SearchRunner;
  readonly terminal?: CommandRunner;
  readonly web?: WebFetcher;
  readonly codeMap?: CodeMapQuery;
}
