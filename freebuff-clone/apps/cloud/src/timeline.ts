import type { SandboxPhase } from "@freebuff/sandbox-orchestrator";

/**
 * The status timeline is the one place a sandbox may show motion: the step that
 * is currently running carries an animated marker, every other step is a named
 * glyph. The model is pure so transitions can be tested without a container.
 */
export type TimelineState = "done" | "active" | "failed" | "pending";

export interface TimelineStep {
  readonly id: string;
  readonly label: string;
  readonly state: TimelineState;
  readonly detail?: string;
}

const ORDER = ["provisioning", "cloning", "installing", "starting", "running"] as const;

/** Index of the step that is running at each phase; `null` means no motion. */
const ACTIVE: Record<SandboxPhase, number | null> = {
  creating: 0,
  cloning: 1,
  installing: 2,
  starting: 3,
  ready: null,
  failed: null,
  stopped: null,
};

/** How far the timeline has progressed for a phase. */
const DONE: Record<SandboxPhase, number> = {
  creating: 0,
  cloning: 1,
  installing: 2,
  starting: 3,
  ready: 5,
  failed: 3,
  stopped: 5,
};

export const timelineSteps = (
  phase: SandboxPhase,
  error?: string,
): readonly TimelineStep[] => {
  const active = ACTIVE[phase];
  const done = DONE[phase];
  const stopped = phase === "stopped";
  const labels: Record<(typeof ORDER)[number], string> = {
    provisioning: "provisioning",
    cloning: "cloning",
    installing: "installing",
    starting: "starting",
    running: "running",
  };
  const steps: TimelineStep[] = ORDER.map((id, index) => {
    if (phase === "failed" && index === Math.max(0, active ?? done - 1)) {
      return {
        id,
        label: "failed",
        state: "failed",
        ...(error === undefined ? {} : { detail: error }),
      };
    }
    if (index < done) {
      return { id, label: labels[id], state: "done" };
    }
    if (index === active) {
      return { id, label: labels[id], state: "active" };
    }
    if (id === "running" && phase === "ready") {
      return { id, label: labels[id], state: "done" };
    }
    return { id, label: labels[id], state: "pending" };
  });
  if (stopped) {
    return [...steps, { id: "stopped", label: "stopped", state: "done" }];
  }
  return steps;
};

export interface TimelineRenderOptions {
  readonly phase: SandboxPhase;
  readonly error?: string;
}

/** Server-rendered timeline; `data-state` drives the CSS, text carries meaning. */
export const timelineHtml = (options: TimelineRenderOptions): string => {
  const steps = timelineSteps(options.phase, options.error);
  const items = steps
    .map((step) => {
      const marker =
        step.state === "done"
          ? "✓"
          : step.state === "failed"
            ? "✗"
            : step.state === "active"
              ? "▸"
              : "○";
      return [
        `<li class="step" data-step="${step.id}" data-state="${step.state}">`,
        `<span class="marker" aria-hidden="true">${marker}</span>`,
        `<span class="step-label">${step.label}</span>`,
        step.detail === undefined
          ? ""
          : `<span class="step-detail">${escapeHtml(step.detail)}</span>`,
        "</li>",
      ].join("");
    })
    .join("");
  return `<ol class="timeline" data-phase="${options.phase}">${items}</ol>`;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
