import { terminalTheme } from "./tokens";
import type { ThemeRole } from "./tokens";

export interface ColorMode {
  /** `false` is the `--no-color` mode: output carries no escape sequences. */
  readonly color: boolean;
}

export const colorMode = (color: boolean): ColorMode => ({ color });

/** ANSI index for a role, i.e. `fg-<index>` in the documented table. */
export const roleAnsi = (role: ThemeRole): number => terminalTheme[role].ansi;

/** hex for a role, used by true-colour renderers (OpenTUI, HTML). */
export const roleHex = (role: ThemeRole): string => terminalTheme[role].hex;

export const paint = (role: ThemeRole, text: string, mode: ColorMode): string =>
  mode.color
    ? `\u001b[38;5;${String(roleAnsi(role))}m${text}\u001b[0m`
    : text;

export const paintDim = (text: string, mode: ColorMode): string =>
  mode.color ? `\u001b[2m${text}\u001b[0m` : text;

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");
