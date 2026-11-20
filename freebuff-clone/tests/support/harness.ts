import {
  FileSystemWorkspace,
  ProcessCommandRunner,
  RipgrepSearchRunner,
  ToolRegistry,
  createDefaultTools,
} from "@freebuff/agent-runtime";
import type { ToolExecutionContext } from "@freebuff/agent-runtime";
import type { AgentEvent, AgentLimits } from "@freebuff/shared";

export const TEST_LIMITS: AgentLimits = {
  maxSteps: 12,
  maxTokens: 500_000,
  maxWallClockMs: 60_000,
  maxParallelSubagents: 4,
};

export interface Harness {
  readonly workspace: FileSystemWorkspace;
  readonly registry: ToolRegistry;
  readonly context: ToolExecutionContext;
  readonly events: AgentEvent[];
  readonly emit: (event: AgentEvent) => void;
  readonly controller: AbortController;
}

export const createHarness = (
  root: string,
  options: { readonly emit?: (event: AgentEvent, harness: Harness) => void } = {},
): Harness => {
  const workspace = new FileSystemWorkspace(root);
  const controller = new AbortController();
  const registry = new ToolRegistry();
  for (const tool of createDefaultTools()) {
    registry.register(tool);
  }
  const events: AgentEvent[] = [];

  const harness = {
    workspace,
    registry,
    events,
    controller,
    context: {
      workspace,
      signal: controller.signal,
      search: new RipgrepSearchRunner(root),
      terminal: new ProcessCommandRunner(root),
    } satisfies ToolExecutionContext,
    emit: (event: AgentEvent): void => {
      events.push(event);
      options.emit?.(event, harness);
    },
  };
  return harness;
};
