/**
 * One semantic token layer for every surface. Terminal roles resolve to ANSI
 * 256 colours, web roles resolve to CSS custom properties; both are generated
 * from this table so the CLI and the browser cannot drift into two palettes.
 */
export const themeRoles = [
  "surface",
  "surface-raised",
  "text-primary",
  "text-secondary",
  "text-muted",
  "accent",
  "success",
  "danger",
  "warning",
  "sponsored",
] as const;

export type ThemeRole = (typeof themeRoles)[number];

export interface TerminalColor {
  /** ANSI 256 index; `fg-<ansi>` in documentation. */
  readonly ansi: number;
  /** The same colour as a hex value, for renderers that speak true colour. */
  readonly hex: string;
}

export const terminalTheme: Record<ThemeRole, TerminalColor> = {
  surface: { ansi: 234, hex: "#07090f" },
  "surface-raised": { ansi: 236, hex: "#121622" },
  "text-primary": { ansi: 255, hex: "#e9edf7" },
  "text-secondary": { ansi: 250, hex: "#c3cad9" },
  "text-muted": { ansi: 244, hex: "#9aa5b8" },
  accent: { ansi: 39, hex: "#7c8cff" },
  success: { ansi: 34, hex: "#4ade80" },
  danger: { ansi: 196, hex: "#ff7a90" },
  warning: { ansi: 214, hex: "#fbbf24" },
  sponsored: { ansi: 244, hex: "#9aa5b8" },
};

export const webTheme: Record<ThemeRole, string> = {
  surface: "--surface",
  "surface-raised": "--surface-raised",
  "text-primary": "--text-primary",
  "text-secondary": "--text-secondary",
  "text-muted": "--text-muted",
  accent: "--accent",
  success: "--success",
  danger: "--danger",
  warning: "--warning",
  sponsored: "--sponsored",
};

export const tokens = { terminal: terminalTheme, web: webTheme } as const;

/** CSS declarations for the shared token block, in a stable role order. */
export const webThemeCss = (): string =>
  themeRoles
    .map((role) => `${webTheme[role]}: ${terminalTheme[role].hex};`)
    .join("\n    ");
