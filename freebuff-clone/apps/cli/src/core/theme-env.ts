export interface ThemeEnv {
  /** `NO_COLOR`, `--no-color` and non-TTY output all disable escape sequences. */
  readonly color: boolean;
  readonly width: number;
}

export const resolveThemeEnv = (
  options: { readonly noColor?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): ThemeEnv => ({
  color:
    options.noColor !== true &&
    env["NO_COLOR"] === undefined &&
    process.stdout.isTTY === true,
  width: Math.min(100, Math.max(40, process.stdout.columns ?? 80)),
});
