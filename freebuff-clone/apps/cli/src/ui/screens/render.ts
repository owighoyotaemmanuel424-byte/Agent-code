import { formatSponsoredAd } from "@freebuff/ads";
import { glyphs, paint, paintDim, stripAnsi } from "@freebuff/shared";
import type { ColorMode, ThemeRole } from "@freebuff/shared";
import { validateScreen } from "./types";
import type { BoxNode, ListNode, Screen, ScreenNode } from "./types";

export interface ScreenRenderOptions {
  readonly width: number;
  readonly color: boolean;
}

const clip = (text: string, width: number): string => {
  const flat = text.replace(/\s+/g, " ").trimEnd();
  if (width <= 0) {
    return "";
  }
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
};

const wrap = (text: string, width: number): readonly string[] => {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length === 0) {
      continue;
    }
    if (current.length === 0) {
      current = clip(word, width);
      continue;
    }
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = clip(word, width);
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.length === 0 ? [""] : lines;
};

const padTo = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - stripAnsi(text).length));

const paintLine = (
  text: string,
  role: ThemeRole,
  mode: ColorMode,
  emphasis: "strong" | "dim" | undefined,
): string => {
  const painted = paint(role, text, mode);
  return emphasis === "dim" ? paintDim(painted, mode) : painted;
};

const renderList = (node: ListNode, width: number, mode: ColorMode): readonly string[] => {
  const rows: { text: string; role: ThemeRole; emphasis?: "strong" | "dim" }[] = [];
  let index = 0;
  for (const group of node.groups) {
    rows.push({ text: group.label, role: "text-muted" });
    for (const item of group.items) {
      const selected = index === node.selected;
      const cursor = selected ? glyphs.cursor : " ";
      const detail = item.detail === undefined ? "" : `  ${item.detail}`;
      rows.push({
        text: `${cursor} ${item.label}${detail}`,
        role: item.role,
        emphasis: selected ? "strong" : item.problem === undefined ? undefined : "dim",
      });
      index += 1;
    }
  }
  const filled = [...rows];
  while (filled.length < node.height) {
    filled.push({ text: "", role: "text-muted" });
  }
  return filled
    .slice(0, node.height)
    .map((row) => paintLine(clip(row.text, width), row.role, mode, row.emphasis));
};

const renderBox = (node: BoxNode, width: number, mode: ColorMode): readonly string[] => {
  const bordered = node.border !== false && width >= 6;
  if (!bordered) {
    return node.children.flatMap((child) => renderNode(child, width, mode));
  }
  const inner = width - 2;
  const body = node.children.flatMap((child) => renderNode(child, inner, mode));
  const limit = node.height === undefined ? body.length : Math.max(0, node.height - 2);
  const rows = body.slice(0, limit);
  while (rows.length < limit) {
    rows.push("");
  }
  const label = node.title === undefined ? "" : `─ ${node.title} `;
  const border = (text: string): string => paint("text-muted", text, mode);
  return [
    border(`╭${label}${"─".repeat(Math.max(0, inner - label.length))}╮`),
    ...rows.map((row) => `${border("│")}${padTo(row, inner)}${border("│")}`),
    border(`╰${"─".repeat(inner)}╯`),
  ];
};

const renderNode = (node: ScreenNode, width: number, mode: ColorMode): readonly string[] => {
  switch (node.kind) {
    case "text":
      return wrap(node.content, width).map((line) =>
        paintLine(line, node.role, mode, node.emphasis),
      );
    case "list":
      return renderList(node, width, mode);
    case "box":
      return renderBox(node, width, mode);
    case "ad": {
      const adBox: BoxNode = {
        kind: "box",
        id: node.id,
        region: "ad",
        title: "Sponsored",
        height: node.height,
        children: formatSponsoredAd(node.ad).map((line, index) => ({
          kind: "text" as const,
          id: `${node.id}-${String(index)}`,
          role: "sponsored" as const,
          content: line,
        })),
      };
      return renderBox(adBox, width, mode);
    }
  }
};

/** Renders a screen to lines. Refuses any tree that breaks the ad rules. */
export const renderScreen = (
  screen: Screen,
  options: ScreenRenderOptions,
): readonly string[] => {
  validateScreen(screen);
  return screen.children.flatMap((node) =>
    renderNode(node, options.width, { color: options.color }),
  );
};

export const renderScreenText = (
  screen: Screen,
  options: ScreenRenderOptions,
): string => `${renderScreen(screen, options).join("\n")}\n`;
