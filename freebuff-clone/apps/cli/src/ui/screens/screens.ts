import { glyphs, runStates } from "@freebuff/shared";
import type { Ad, Plan, RunState } from "@freebuff/shared";
import { formatClock, formatHours, formatRemaining } from "./format";
import { AD_ROW_HEIGHT } from "./types";
import type { ListGroup, ListItem, ListNode, Screen, ScreenNode } from "./types";

export interface ModelChoice {
  readonly id: string;
  readonly displayName: string;
  readonly provider: string;
  readonly planTiers: readonly Plan[];
  readonly allowed: boolean;
}

const modelItem = (model: ModelChoice) => ({
  id: `model-${model.id}`,
  label: model.displayName,
  detail: model.allowed ? model.id : `${model.id} · paid plan required`,
  role: model.allowed ? ("text-primary" as const) : ("text-muted" as const),
});

/** Models in picker order: unlimited (free tier) first, then premium. */
export const orderModels = (models: readonly ModelChoice[]): readonly ModelChoice[] => [
  ...models.filter((model) => model.planTiers.includes("free")),
  ...models.filter((model) => !model.planTiers.includes("free")),
];

export interface ModelPickerInput {
  readonly models: readonly ModelChoice[];
  readonly plan: Plan;
  readonly selected: number;
  readonly recommendedId?: string;
  readonly notice?: string;
  readonly ad?: Ad;
}

export const buildModelPickerScreen = (input: ModelPickerInput): Screen => {
  const ordered = orderModels(input.models);
  const recommended =
    input.recommendedId ?? ordered.find((model) => model.allowed)?.id;
  const itemFor = (model: ModelChoice): ListItem => {
    const item = modelItem(model);
    return model.id === recommended
      ? { ...item, label: `${item.label} ${glyphs.recommended} (recommended)` }
      : item;
  };
  const unlimited = ordered
    .filter((model) => model.planTiers.includes("free"))
    .map(itemFor);
  const premium = ordered
    .filter((model) => !model.planTiers.includes("free"))
    .map(itemFor);
  const groups: ListGroup[] = [
    ...(unlimited.length === 0 ? [] : [{ label: "UNLIMITED", items: unlimited }]),
    ...(premium.length === 0 ? [] : [{ label: "PREMIUM", items: premium }]),
  ];
  const count = unlimited.length + premium.length;
  const list: ListNode = {
    kind: "list",
    id: "model-list",
    region: "chrome",
    groups,
    selected: input.selected,
    height: count + groups.length + 1,
  };
  return {
    id: "model-picker",
    title: "Choose a model",
    children: [
      {
        kind: "text",
        id: "model-header",
        role: "text-secondary",
        content: `Plan: ${input.plan} · ${String(count)} models`,
        emphasis: "strong",
      },
      list,
      ...(input.notice === undefined
        ? []
        : [
            {
              kind: "text" as const,
              id: "model-notice",
              role: "warning" as const,
              content: input.notice,
            },
          ]),
      {
        kind: "text",
        id: "model-hint",
        role: "text-muted",
        content: "↑/↓ move · Enter select · q quit",
        emphasis: "dim",
      },
      ...(input.ad === undefined
        ? []
        : [
            {
              kind: "ad" as const,
              id: "model-ad",
              region: "ad" as const,
              height: AD_ROW_HEIGHT,
              ad: input.ad,
            },
          ]),
    ],
  };
};

export interface ProjectCandidate {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly branch?: string;
  /** Why the entry cannot be opened; rendered in text-muted, never a crash. */
  readonly problem?: string;
  readonly recovery?: string;
}

export interface ProjectPickerInput {
  readonly projects: readonly ProjectCandidate[];
  readonly selected: number;
  readonly notice?: string;
  readonly ad?: Ad;
}

export const buildProjectPickerScreen = (input: ProjectPickerInput): Screen => {
  const items = input.projects.map((project) => ({
    id: `project-${project.id}`,
    label: project.name,
    detail:
      project.problem === undefined
        ? `${project.branch ?? "no branch"} · ${project.path}`
        : `${project.path} · ${project.problem}`,
    role: project.problem === undefined ? ("text-primary" as const) : ("text-muted" as const),
    ...(project.recovery === undefined ? {} : { recovery: project.recovery }),
  }));
  const selected = input.projects[input.selected];
  return {
    id: "project-picker",
    title: "Choose a project",
    children: [
      {
        kind: "text",
        id: "project-header",
        role: "text-secondary",
        content: `Projects · ${String(items.length)} registered`,
        emphasis: "strong",
      },
      {
        kind: "list",
        id: "project-list",
        region: "chrome",
        groups: [{ label: "RECENT PROJECTS", items }],
        selected: input.selected,
        height: Math.max(3, items.length + 2),
      },
      ...(selected?.recovery === undefined
        ? []
        : [
            {
              kind: "text" as const,
              id: "project-recovery",
              role: "text-muted" as const,
              content: `${selected.recovery} Press Enter to choose anyway.`,
              emphasis: "dim" as const,
            },
          ]),
      ...(input.notice === undefined
        ? []
        : [
            {
              kind: "text" as const,
              id: "project-notice",
              role: "warning" as const,
              content: input.notice,
            },
          ]),
      {
        kind: "text",
        id: "project-hint",
        role: "text-muted",
        content: "[n] new project · [r] recent · [q] quit",
        emphasis: "dim",
      },
      ...(input.ad === undefined
        ? []
        : [
            {
              kind: "ad" as const,
              id: "project-ad",
              region: "ad" as const,
              height: AD_ROW_HEIGHT,
              ad: input.ad,
            },
          ]),
    ],
  };
};

export type DeviceAuthStatus = "waiting" | "authorized" | "expired";

const authStatusText: Record<DeviceAuthStatus, { content: string; role: "warning" | "success" | "danger" }> = {
  waiting: { content: "Waiting for authorization…", role: "warning" },
  authorized: { content: "Authorized. Starting the model picker…", role: "success" },
  expired: { content: "This code expired. Press r to request a new one.", role: "danger" },
};

export interface DeviceAuthInput {
  readonly email: string;
  readonly code: string;
  readonly url: string;
  readonly status: DeviceAuthStatus;
}

export const buildDeviceAuthScreen = (input: DeviceAuthInput): Screen => {
  const status = authStatusText[input.status];
  return {
    id: "device-auth",
    title: "Jubilant",
    children: [
      {
        kind: "box",
        id: "auth-card",
        region: "chrome",
        title: "Jubilant",
        height: 9,
        children: [
          {
            kind: "text",
            id: "auth-account",
            role: "text-secondary",
            content: input.email,
          },
          {
            kind: "text",
            id: "auth-code",
            role: "text-primary",
            content: `Device code  ${input.code}`,
            emphasis: "strong",
          },
          {
            kind: "text",
            id: "auth-url",
            role: "text-muted",
            content: `Open  ${input.url}`,
          },
          {
            kind: "text",
            id: "auth-status",
            role: status.role,
            content: `${runStates.thinking.glyph} ${status.content}`,
          },
        ],
      },
    ],
  };
};

export type StreamEntry =
  | { readonly kind: "message"; readonly id: string; readonly role: "user" | "assistant"; readonly content: string }
  | { readonly kind: "thinking"; readonly id: string; readonly content: string }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly name: string;
      readonly target?: string;
      readonly status: "running" | "done" | "error";
    }
  | {
      readonly kind: "diff";
      readonly id: string;
      readonly path: string;
      readonly added: number;
      readonly removed: number;
      readonly lines?: readonly { readonly kind: "added" | "removed" | "context"; readonly text: string }[];
    }
  | { readonly kind: "error"; readonly id: string; readonly message: string; readonly retryKey: string };

const toolBadge = {
  running: runStates.tool,
  done: runStates.done,
  error: runStates.error,
} as const;

export const buildStreamNodes = (entries: readonly StreamEntry[]): readonly ScreenNode[] =>
  entries.map((entry): ScreenNode => {
    switch (entry.kind) {
      case "message":
        return {
          kind: "text",
          id: entry.id,
          role: entry.role === "user" ? "text-secondary" : "text-primary",
          content: `${entry.role === "user" ? "you" : "jubilant"}: ${entry.content}`,
        };
      case "thinking":
        return {
          kind: "text",
          id: entry.id,
          role: "text-muted",
          content: `${runStates.thinking.glyph} thinking ${entry.content}`,
          emphasis: "dim",
        };
      case "tool": {
        const badge = toolBadge[entry.status];
        return {
          kind: "box",
          id: entry.id,
          region: "stream",
          title: `${glyphs.recommended} ${entry.name}`,
          height: 3,
          children: [
            {
              kind: "text",
              id: `${entry.id}-target`,
              role: "text-secondary",
              content: entry.target ?? "(no target)",
            },
            {
              kind: "text",
              id: `${entry.id}-status`,
              role: badge.role,
              content: `${badge.glyph} ${badge.label}`,
            },
          ],
        };
      }
      case "diff": {
        const header: ScreenNode = {
          kind: "text",
          id: `${entry.id}-header`,
          role: "text-secondary",
          content: `± ${entry.path}  ${glyphs.added}${String(entry.added)} ${glyphs.removed}${String(entry.removed)}`,
          emphasis: "strong",
        };
        const lines: ScreenNode[] = (entry.lines ?? []).map((line, index) => ({
          kind: "text",
          id: `${entry.id}-line-${String(index)}`,
          role: line.kind === "added" ? "success" : line.kind === "removed" ? "danger" : "text-muted",
          content:
            line.kind === "added"
              ? `${glyphs.added} ${line.text}`
              : line.kind === "removed"
                ? `${glyphs.removed} ${line.text}`
                : `  ${line.text}`,
        }));
        return {
          kind: "box",
          id: entry.id,
          region: "stream",
          border: false,
          children: [header, ...lines],
        };
      }
      case "error":
        return {
          kind: "box",
          id: entry.id,
          region: "stream",
          title: `${runStates.error.glyph} error`,
          height: 4,
          children: [
            {
              kind: "text",
              id: `${entry.id}-message`,
              role: "danger",
              content: entry.message,
            },
            {
              kind: "text",
              id: `${entry.id}-retry`,
              role: "text-muted",
              content: `Press ${entry.retryKey} to retry — the session is kept.`,
            },
          ],
        };
    }
  });

export interface StatusLineInput {
  readonly state: RunState;
  readonly projectName: string;
  readonly modelId: string;
  readonly elapsedSeconds: number;
  readonly consumedSeconds: number;
  readonly hoursPerDay: number;
}

/** One static status bar: state glyph, project, model, timer, quota. */
export const formatStatusLine = (input: StatusLineInput): string => {
  const badge = runStates[input.state];
  return [
    badge.glyph,
    badge.label,
    input.projectName,
    input.modelId,
    formatClock(input.elapsedSeconds),
    `Today ${formatHours(input.consumedSeconds)}h / ${String(input.hoursPerDay)}h`,
  ].join(` ${glyphs.bullet} `);
};

export interface AgentScreenInput {
  readonly modelId: string;
  readonly projectName: string;
  readonly entries: readonly StreamEntry[];
  readonly state: RunState;
  readonly elapsedSeconds: number;
  readonly consumedSeconds: number;
  readonly hoursPerDay: number;
  readonly ad?: Ad;
}

export const buildAgentScreen = (input: AgentScreenInput): Screen => {
  return {
    id: "agent",
    title: input.projectName,
    children: [
      {
        kind: "box",
        id: "stream",
        region: "stream",
        flexGrow: true,
        children: buildStreamNodes(input.entries),
      },
      ...(input.ad === undefined
        ? []
        : [
            {
              kind: "ad" as const,
              id: "agent-ad",
              region: "ad" as const,
              height: AD_ROW_HEIGHT,
              ad: input.ad,
            },
          ]),
      {
        kind: "box",
        id: "composer",
        region: "composer",
        title: input.state === "tool" || input.state === "thinking" ? "Prompt · working" : "Prompt",
        height: 3,
        children: [
          {
            kind: "text",
            id: "composer-input",
            role: "text-muted",
            content: "Describe the change  (Enter sends, Shift+Enter adds a line)",
          },
        ],
      },
      {
        kind: "text",
        id: "status",
        role: "text-secondary",
        content: formatStatusLine({
          state: input.state,
          projectName: input.projectName,
          modelId: input.modelId,
          elapsedSeconds: input.elapsedSeconds,
          consumedSeconds: input.consumedSeconds,
          hoursPerDay: input.hoursPerDay,
        }),
      },
      {
        kind: "text",
        id: "agent-hint",
        role: "text-muted",
        content: "Enter sends · Shift+Enter adds a line · ctrl+u quota · Esc cancels",
        emphasis: "dim",
      },
    ],
  };
};

export interface QuotaDashboardInput {
  readonly plan: Plan;
  readonly countryCode: string;
  readonly timeZone: string;
  readonly hoursPerDay: number;
  readonly consumedSeconds: number;
  readonly resetsAt: string;
  readonly now: Date;
  readonly unlimitedModels: readonly string[];
  readonly meteredModels: readonly string[];
  readonly ad?: Ad;
  readonly barWidth?: number;
}

export const quotaBar = (
  consumedSeconds: number,
  hoursPerDay: number,
  width: number,
): string => {
  const allowance = Math.max(1, hoursPerDay * 3600);
  const ratio = Math.min(1, Math.max(0, consumedSeconds / allowance));
  const filled = Math.round(ratio * width);
  return `${glyphs.barFull.repeat(filled)}${glyphs.barEmpty.repeat(Math.max(0, width - filled))}`;
};

export const buildQuotaDashboardScreen = (input: QuotaDashboardInput): Screen => {
  const width = input.barWidth ?? 24;
  const allowance = input.hoursPerDay * 3600;
  const percent = Math.round(
    Math.min(1, Math.max(0, input.consumedSeconds / Math.max(1, allowance))) * 100,
  );
  const remaining = formatRemaining(input.resetsAt, input.now);
  const meterChildren: ScreenNode[] = [
    {
      kind: "text",
      id: "quota-bar",
      role: "accent",
      content: `${quotaBar(input.consumedSeconds, input.hoursPerDay, width)}  ${formatHours(input.consumedSeconds)}h / ${String(input.hoursPerDay)}h  ${String(percent)}%`,
      emphasis: "strong",
    },
    {
      kind: "text",
      id: "quota-reset",
      role: "text-muted",
      content: `Resets in ${remaining} (local midnight, ${input.timeZone})`,
    },
  ];
  return {
    id: "quota",
    title: "Quota",
    children: [
      ...(input.ad === undefined
        ? []
        : [
            {
              kind: "ad" as const,
              id: "quota-ad",
              region: "ad" as const,
              height: AD_ROW_HEIGHT,
              ad: input.ad,
            },
          ]),
      {
        kind: "text",
        id: "quota-header",
        role: "text-secondary",
        content: `${input.plan} plan · ${input.countryCode} · ${input.timeZone}`,
        emphasis: "strong",
      },
      {
        kind: "box",
        id: "quota-today",
        region: "chrome",
        title: "Today",
        height: 4,
        children: meterChildren,
      },
      {
        kind: "box",
        id: "quota-unlimited",
        region: "chrome",
        title: "Unlimited models",
        height: Math.max(3, input.unlimitedModels.length + 2),
        children: input.unlimitedModels.map((name, index) => ({
          kind: "text" as const,
          id: `unlimited-${String(index)}`,
          role: "text-primary" as const,
          content: `${glyphs.bullet} ${name}`,
        })),
      },
      {
        kind: "box",
        id: "quota-metered",
        region: "chrome",
        title: "Metered models",
        height: Math.max(3, input.meteredModels.length + 2),
        children: input.meteredModels.map((name, index) => ({
          kind: "text" as const,
          id: `metered-${String(index)}`,
          role: "text-muted" as const,
          content: `${glyphs.bullet} ${name} · paid plan`,
        })),
      },
      {
        kind: "box",
        id: "quota-upgrade",
        region: "chrome",
        title: "Upgrade",
        height: 4,
        children: [
          {
            kind: "text",
            id: "quota-upgrade-bar",
            role: "accent",
            content: `${glyphs.barFull.repeat(width)}  today ${String(input.hoursPerDay)}h`,
            emphasis: "strong",
          },
          {
            kind: "text",
            id: "quota-upgrade-cta",
            role: "text-muted",
            content: "More hours and no sponsored slots · run: freebuff upgrade",
          },
        ],
      },
    ],
  };
};
