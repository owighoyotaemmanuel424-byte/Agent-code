import { describe, expect, it } from "vitest";
import {
  paint,
  paintDim,
  roleAnsi,
  roleHex,
  runStates,
  stripAnsi,
  terminalTheme,
  themeRoles,
  tokens,
  webTheme,
  webThemeCss,
} from "@freebuff/shared";

describe("shared design tokens", () => {
  it("defines every required role once for both surfaces", () => {
    expect([...themeRoles].sort()).toEqual(
      [
        "accent",
        "danger",
        "sponsored",
        "success",
        "surface",
        "surface-raised",
        "text-muted",
        "text-primary",
        "text-secondary",
        "warning",
      ].sort(),
    );
    expect(Object.keys(tokens.terminal).sort()).toEqual(Object.keys(tokens.web).sort());
  });

  it("pins the documented ANSI 256 mapping", () => {
    expect(roleAnsi("accent")).toBe(39);
    expect(roleAnsi("success")).toBe(34);
    expect(roleAnsi("danger")).toBe(196);
    expect(roleAnsi("warning")).toBe(214);
    expect(roleAnsi("sponsored")).toBe(244);
    expect(terminalTheme.accent.hex).toBe("#7c8cff");
  });

  it("emits the same palette as CSS custom properties", () => {
    const css = webThemeCss();
    for (const role of themeRoles) {
      expect(webTheme[role]).toMatch(/^--[a-z-]+$/);
      expect(css).toContain(`${webTheme[role]}: ${terminalTheme[role].hex};`);
    }
    expect(css).toContain("--accent: #7c8cff;");
    expect(css).toContain("--sponsored: #9aa5b8;");
  });

  it("paints ANSI 256 in colour mode and nothing in no-color mode", () => {
    const colored = paint("accent", "hello", { color: true });
    expect(colored).toBe("\u001b[38;5;39mhello\u001b[0m");
    expect(stripAnsi(colored)).toBe("hello");
    expect(paintDim(colored, { color: false })).toBe(colored);
    expect(paint("accent", "hello", { color: false })).toBe("hello");
    expect(paintDim("dim", { color: false })).toBe("dim");
    expect(roleHex("danger")).toBe(terminalTheme.danger.hex);
  });

  it("names every run state with a glyph and a word", () => {
    for (const badge of Object.values(runStates)) {
      expect(badge.glyph.length).toBeGreaterThan(0);
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.label).toBe(badge.label.toLowerCase());
    }
  });
});
