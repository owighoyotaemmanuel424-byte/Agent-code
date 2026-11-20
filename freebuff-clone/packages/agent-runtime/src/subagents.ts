export type SubagentStatus = "completed" | "failed" | "cancelled";

export interface SubagentOutcome {
  readonly task: string;
  readonly status: SubagentStatus;
  readonly summary: string;
}

export interface SubagentSpawnResult {
  readonly status: SubagentStatus;
  readonly summary: string;
}

export interface ParallelSubagentOptions {
  readonly maxParallel: number;
  readonly signal?: AbortSignal;
  readonly spawn: (task: string, index: number) => Promise<SubagentSpawnResult>;
  readonly onStart?: (task: string, index: number) => void;
  readonly onFinish?: (outcome: SubagentOutcome, index: number) => void;
}

/**
 * Runs subagent tasks through a fixed-size worker pool. Results are returned in
 * task order regardless of completion order, and cancellation stops new work
 * while reporting unfinished tasks as cancelled.
 */
export const runParallelSubagents = async (
  tasks: readonly string[],
  options: ParallelSubagentOptions,
): Promise<SubagentOutcome[]> => {
  const results: (SubagentOutcome | undefined)[] = new Array<SubagentOutcome | undefined>(
    tasks.length,
  ).fill(undefined);
  let cursor = 0;
  const limit = Math.max(1, Math.min(options.maxParallel, Math.max(1, tasks.length)));

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted === true) {
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) {
        return;
      }
      const task = tasks[index] ?? "";
      options.onStart?.(task, index);
      try {
        const result = await options.spawn(task, index);
        results[index] = { task, status: result.status, summary: result.summary };
      } catch (error) {
        results[index] = {
          task,
          status: "failed",
          summary: error instanceof Error ? error.message : "Subagent failed",
        };
      }
      const outcome = results[index];
      if (outcome !== undefined) {
        options.onFinish?.(outcome, index);
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));

  return results.map(
    (result, index) =>
      result ?? {
        task: tasks[index] ?? "",
        status: "cancelled" as const,
        summary: "Cancelled before start",
      },
  );
};
