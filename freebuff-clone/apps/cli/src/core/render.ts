import type { AdDecision } from "@freebuff/ads";
import type { AgentEvent } from "@freebuff/shared";
import { formatSponsoredAd } from "@freebuff/ads";

export interface OutputSink {
  write(text: string): void;
}

export interface HeadlessRenderer {
  readonly emit: (event: AgentEvent) => void;
  readonly ad: (decision: AdDecision | undefined) => void;
  readonly info: (text: string) => void;
  readonly error: (text: string) => void;
}

/**
 * Plain-text rendering of the same event stream the TUI consumes. Sponsored
 * slots print with their label and never interrupt a tool call.
 */
export const createHeadlessRenderer = (sink: OutputSink): HeadlessRenderer => ({
  emit: (event) => {
    switch (event.type) {
      case "message.delta":
        sink.write(event.delta);
        break;
      case "tool.started":
        sink.write(`\n· ${event.name}\n`);
        break;
      case "tool.finished":
        if (event.result.status === "error") {
          sink.write(`  ✗ ${event.result.error.message}\n`);
        } else if (event.result.status === "cancelled") {
          sink.write("  ✗ cancelled\n");
        } else {
          sink.write("  ✓\n");
        }
        break;
      case "run.completed": {
        const tokens = event.usage.inputTokens + event.usage.outputTokens;
        sink.write(
          `\n[${event.status}${event.errorCode === undefined ? "" : `: ${event.errorCode}`}] ${String(tokens)} tokens\n`,
        );
        break;
      }
      default:
        break;
    }
  },
  ad: (decision) => {
    if (decision === undefined) {
      return;
    }
    sink.write(`\n${formatSponsoredAd(decision.ad).join("\n")}\n\n`);
  },
  info: (text) => {
    sink.write(`${text}\n`);
  },
  error: (text) => {
    sink.write(`error: ${text}\n`);
  },
});
