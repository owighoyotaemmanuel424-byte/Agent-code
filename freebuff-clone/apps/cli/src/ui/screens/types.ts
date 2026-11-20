import { AppError } from "@freebuff/shared";
import type { Ad, ThemeRole } from "@freebuff/shared";

/**
 * Screens are described as data and rendered twice: once to plain text for
 * headless CI (`--no-color`) and once to OpenTUI elements for the terminal.
 * Because both renderers walk the same tree, the structural rules (R1–R4) are
 * testable without a screen.
 */
export type ScreenId =
  | "device-auth"
  | "model-picker"
  | "project-picker"
  | "agent"
  | "quota";

export type ScreenRegion = "chrome" | "stream" | "ad" | "composer" | "status";

/** Fixed sponsored row height. Rotation can never change layout (R3). */
export const AD_ROW_HEIGHT = 4;

export interface TextNode {
  readonly kind: "text";
  readonly id: string;
  readonly role: ThemeRole;
  readonly content: string;
  readonly emphasis?: "strong" | "dim";
}

export interface ListItem {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly role: ThemeRole;
  /** Why this entry cannot be opened, rendered in text-muted. */
  readonly problem?: string;
  /** Inline recovery path, never a modal (R9). */
  readonly recovery?: string;
}

export interface ListGroup {
  readonly label: string;
  readonly items: readonly ListItem[];
}

export interface ListNode {
  readonly kind: "list";
  readonly id: string;
  readonly region: ScreenRegion;
  readonly groups: readonly ListGroup[];
  readonly selected: number;
  readonly height: number;
}

export interface BoxNode {
  readonly kind: "box";
  readonly id: string;
  readonly region: ScreenRegion;
  readonly title?: string;
  /** Fixed height in rows, borders included. */
  readonly height?: number;
  readonly flexGrow?: boolean;
  readonly border?: boolean;
  readonly children: readonly ScreenNode[];
}

export interface AdNode {
  readonly kind: "ad";
  readonly id: string;
  readonly region: "ad";
  readonly height: number;
  readonly ad: Ad;
}

export type ScreenNode = TextNode | ListNode | BoxNode | AdNode;

export interface Screen {
  readonly id: ScreenId;
  readonly title: string;
  readonly children: readonly ScreenNode[];
}

export interface WalkedNode {
  readonly node: ScreenNode;
  readonly ancestors: readonly ScreenNode[];
}

export const walkScreen = (
  nodes: readonly ScreenNode[],
  ancestors: readonly ScreenNode[] = [],
): readonly WalkedNode[] =>
  nodes.flatMap((node) => [
    { node, ancestors },
    ...(node.kind === "box" ? walkScreen(node.children, [...ancestors, node]) : []),
  ]);

export const listItems = (node: ListNode): readonly ListItem[] =>
  node.groups.flatMap((group) => group.items);

export const selectedItem = (node: ListNode): ListItem | undefined =>
  listItems(node)[node.selected];

const fail = (message: string): never => {
  throw new AppError({ code: "validation_failed", message });
};

/**
 * Runtime enforcement of the ad rules. Every renderer calls this first, so a
 * tree that puts an ad in the agent stream, drops the label or changes the
 * reserved height cannot be displayed at all.
 */
export const validateScreen = (screen: Screen): Screen => {
  const walked = walkScreen(screen.children);
  const ads = walked.filter((entry) => entry.node.kind === "ad");
  if (ads.length > 1) {
    fail(`Screen ${screen.id} renders ${String(ads.length)} sponsored slots; one per view`);
  }
  for (const { node, ancestors } of ads) {
    if (node.kind !== "ad") {
      continue;
    }
    const inside = ancestors.filter((ancestor) => ancestor.kind === "box");
    for (const ancestor of inside) {
      if (ancestor.region === "stream") {
        fail(`Sponsored slot ${node.id} is inside the agent stream`);
      }
      if (ancestor.region === "composer") {
        fail(`Sponsored slot ${node.id} is inside the composer`);
      }
    }
    if (node.ad.label !== "Sponsored") {
      fail(`Sponsored slot ${node.id} is missing its literal label`);
    }
    if (node.height !== AD_ROW_HEIGHT) {
      fail(`Sponsored slot ${node.id} has height ${String(node.height)}; expected ${String(AD_ROW_HEIGHT)}`);
    }
  }
  return screen;
};

/** The stream subtree, with its ancestor chain, or `undefined`. */
export const findStream = (screen: Screen): BoxNode | undefined => {
  const stream = walkScreen(screen.children).find(
    (entry) => entry.node.kind === "box" && entry.node.region === "stream",
  );
  return stream?.node.kind === "box" ? stream.node : undefined;
};
