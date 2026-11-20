import type { ThemeRole } from "./tokens";

/**
 * Every state is a glyph plus a word. Colour is decoration, never the only
 * carrier of meaning (design rule R6).
 */
export const glyphs = {
  cursor: "❯",
  recommended: "▸",
  selected: "●",
  unselected: "○",
  barFull: "█",
  barEmpty: "░",
  added: "+",
  removed: "-",
  success: "✓",
  failure: "✗",
  bullet: "·",
  ellipsis: "…",
  arrow: "→",
  rule: "─",
} as const;

export type RunState = "idle" | "thinking" | "tool" | "diff" | "error" | "done";

export interface StateBadge {
  readonly glyph: string;
  readonly label: string;
  readonly role: ThemeRole;
}

export const runStates: Record<RunState, StateBadge> = {
  idle: { glyph: glyphs.bullet, label: "idle", role: "text-muted" },
  thinking: { glyph: glyphs.ellipsis, label: "thinking", role: "text-muted" },
  tool: { glyph: glyphs.recommended, label: "tool running", role: "accent" },
  diff: { glyph: "±", label: "diff arriving", role: "accent" },
  error: { glyph: glyphs.failure, label: "error", role: "danger" },
  done: { glyph: glyphs.success, label: "done", role: "success" },
};

export const stateBadge = (state: RunState): StateBadge => runStates[state];
