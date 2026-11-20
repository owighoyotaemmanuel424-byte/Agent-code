import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { defaultAdInventory } from "@freebuff/ads";
import type { Ad } from "@freebuff/shared";
import { addProject, inspectProject } from "../../../apps/cli/src/core/projects";
import { resolveCliPaths } from "../../../apps/cli/src/core/paths";
import {
  buildAgentScreen,
  buildDeviceAuthScreen,
  buildModelPickerScreen,
  buildProjectPickerScreen,
  buildQuotaDashboardScreen,
} from "../../../apps/cli/src/ui/screens/screens";
import type { ModelChoice, StreamEntry } from "../../../apps/cli/src/ui/screens/screens";
import { renderScreen } from "../../../apps/cli/src/ui/screens/render";
import { findStream, validateScreen } from "../../../apps/cli/src/ui/screens/types";
import type { AdNode, BoxNode, Screen } from "../../../apps/cli/src/ui/screens/types";
import { AdRow, streamElements } from "../../../apps/cli/src/ui/screens/elements";

const firstAd = defaultAdInventory.ads[0] as Ad;
const secondAd = defaultAdInventory.ads[1] as Ad;

const models: readonly ModelChoice[] = [
  {
    id: "deepseek-chat",
    displayName: "DeepSeek Chat",
    provider: "deepseek",
    planTiers: ["free", "paid"],
    allowed: true,
  },
  {
    id: "gpt-4o-mini",
    displayName: "GPT-4o mini",
    provider: "openai",
    planTiers: ["free", "paid"],
    allowed: true,
  },
  {
    id: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    provider: "anthropic",
    planTiers: ["paid"],
    allowed: false,
  },
];

const entries: readonly StreamEntry[] = [
  { kind: "message", id: "m1", role: "user", content: "add a helper" },
  { kind: "thinking", id: "t1", content: "reading src/util.ts" },
  { kind: "tool", id: "tool-1", name: "read_file", target: "src/util.ts", status: "done" },
  {
    kind: "diff",
    id: "diff-1",
    path: "src/util.ts",
    added: 1,
    removed: 1,
    lines: [
      { kind: "removed", text: "export const format = 1;" },
      { kind: "added", text: "export const format = 2;" },
    ],
  },
  { kind: "message", id: "m2", role: "assistant", content: "Updated the helper." },
];

const agentScreen = (ad?: Ad): Screen =>
  buildAgentScreen({
    modelId: "deepseek-chat",
    projectName: "jubilant-engine",
    entries,
    state: "done",
    elapsedSeconds: 42,
    consumedSeconds: 8_040,
    hoursPerDay: 5,
    ...(ad === undefined ? {} : { ad }),
  });

const text = (screen: Screen, color = false, width = 80): string =>
  renderScreen(screen, { width, color }).join("\n");

const isElement = (
  value: unknown,
): value is ReactElement<{ children?: ReactNode; title?: unknown; height?: unknown }> =>
  typeof value === "object" && value !== null && "props" in value && "type" in value;

const collectElements = (node: ReactNode, found: ReactElement[] = []): ReactElement[] => {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      collectElements(child, found);
    }
    return found;
  }
  if (!isElement(node)) {
    return found;
  }
  found.push(node);
  collectElements(node.props.children, found);
  return found;
};

describe("Phase 2 screens", () => {
  it("renders device auth, model picker, project picker, agent view and quota headless", () => {
    const auth = buildDeviceAuthScreen({
      email: "dev@example.com",
      code: "ABC-123",
      url: "https://freebuff.dev/device",
      status: "waiting",
    });
    expect(text(auth)).toContain("Jubilant");
    expect(text(auth)).toContain("ABC-123");
    expect(text(auth)).toContain("Waiting for authorization…");
    expect(text(auth)).toContain("dev@example.com");

    const picker = buildModelPickerScreen({ models, plan: "free", selected: 0, ad: firstAd });
    const pickerText = text(picker);
    expect(pickerText).toContain("UNLIMITED");
    expect(pickerText).toContain("PREMIUM");
    expect(pickerText).toContain("(recommended)");
    expect(pickerText).toContain("DeepSeek Chat");
    expect(pickerText).toContain("paid plan required");
    expect(pickerText).toContain("Sponsored");

    const projects = buildProjectPickerScreen({
      projects: [
        { id: "p1", name: "engine", path: "/work/engine", branch: "main" },
        { id: "p2", name: "scratch", path: "/work/scratch", problem: "not a git repository", recovery: "Run git init here." },
      ],
      selected: 0,
    });
    expect(text(projects)).toContain("engine");
    expect(text(projects)).toContain("main");
    expect(text(projects)).toContain("not a git repository");

    const agent = text(agentScreen(firstAd));
    expect(agent).toContain("+ export const format = 2;");
    expect(agent).toContain("- export const format = 1;");
    expect(agent).toContain("read_file");
    expect(agent).toContain("thinking");
    expect(agent).toContain("Today 2.23h / 5h");

    const quota = buildQuotaDashboardScreen({
      plan: "free",
      countryCode: "US",
      timeZone: "America/Los_Angeles",
      hoursPerDay: 5,
      consumedSeconds: 2 * 3600 + 14 * 60,
      resetsAt: "2026-11-21T08:00:00.000Z",
      now: new Date("2026-11-20T20:14:00.000Z"),
      unlimitedModels: ["DeepSeek Chat"],
      meteredModels: ["Claude Sonnet 4"],
      ad: firstAd,
    });
    const quotaText = text(quota);
    expect(quotaText).toContain("█");
    expect(quotaText).toContain("░");
    expect(quotaText).toContain("Resets in");
    expect(quotaText).toContain("(local midnight, America/Los_Angeles)");
    expect(quotaText).toContain("Unlimited models");
    expect(quotaText).toContain("Metered models");
    expect(quotaText).toContain("Upgrade");
    expect(quotaText).toContain("Sponsored");
  });

  it("keeps the sponsored slot structurally outside the agent stream", () => {
    const screen = agentScreen(firstAd);
    const stream = findStream(screen);
    expect(stream).toBeDefined();
    if (stream === undefined) {
      return;
    }
    expect(JSON.stringify(stream)).not.toContain("Sponsored");

    // Component tree: the stream subtree contains no ad element.
    const streamTree = collectElements(streamElements(stream));
    expect(streamTree.length).toBeGreaterThan(0);
    expect(streamTree.some((element) => element.type === AdRow)).toBe(false);
    expect(
      streamTree.some(
        (element) => (element.props as { readonly title?: unknown }).title === "Sponsored",
      ),
    ).toBe(false);

    // The slot is a sibling of the stream, at the top level.
    const topLevelAd = screen.children.filter((node) => node.kind === "ad");
    expect(topLevelAd).toHaveLength(1);
    expect(text(screen)).toContain("Sponsored");
  });

  it("refuses an ad inside the stream, a second ad, or a missing label", () => {
    const streamBox: BoxNode = {
      kind: "box",
      id: "stream",
      region: "stream",
      children: [
        {
          kind: "ad",
          id: "bad-ad",
          region: "ad",
          height: 4,
          ad: firstAd,
        },
      ],
    };
    const bad: Screen = { id: "agent", title: "bad", children: [streamBox] };
    expect(() => validateScreen(bad)).toThrow(/inside the agent stream/);
    expect(() => renderScreen(bad, { width: 80, color: false })).toThrow();
    expect(() => streamElements(streamBox)).toThrow(/inside the agent stream/);

    const twoAds: Screen = {
      id: "agent",
      title: "two",
      children: [
        { kind: "ad", id: "ad-1", region: "ad", height: 4, ad: firstAd },
        { kind: "ad", id: "ad-2", region: "ad", height: 4, ad: secondAd },
      ],
    };
    expect(() => validateScreen(twoAds)).toThrow(/one per view/);

    const rogue = { ...firstAd, label: "Promoted" } as unknown as Ad;
    const node: AdNode = { kind: "ad", id: "ad-x", region: "ad", height: 4, ad: rogue };
    const unlabelled: Screen = { id: "agent", title: "x", children: [node] };
    expect(() => validateScreen(unlabelled)).toThrow(/label/);
    expect(() => renderScreen(unlabelled, { width: 80, color: false })).toThrow(/label/);
    expect(() => AdRow({ node })).toThrow(/label/);

    const shortRow: AdNode = { kind: "ad", id: "ad-y", region: "ad", height: 2, ad: firstAd };
    expect(() => validateScreen({ id: "agent", title: "y", children: [shortRow] })).toThrow(
      /height/,
    );
  });

  it("keeps the layout fixed when the creative rotates", () => {
    const first = renderScreen(agentScreen(firstAd), { width: 80, color: false });
    const second = renderScreen(agentScreen(secondAd), { width: 80, color: false });
    expect(first.length).toBe(second.length);

    const adIndex = first.findIndex((line) => line.includes("─ Sponsored "));
    expect(adIndex).toBeGreaterThan(0);
    expect(second.findIndex((line) => line.includes("─ Sponsored "))).toBe(adIndex);
    expect(first.slice(0, adIndex)).toEqual(second.slice(0, adIndex));
    expect(first.slice(adIndex + 4)).toEqual(second.slice(adIndex + 4));

    const row = AdRow({
      node: { kind: "ad", id: "ad-z", region: "ad", height: 4, ad: secondAd },
    });
    expect(isElement(row) ? row.props.height : undefined).toBe(4);

    // The stream itself is identical with and without a sponsored slot.
    const withAd = findStream(agentScreen(firstAd));
    const withoutAd = findStream(agentScreen());
    expect(withAd).toBeDefined();
    expect(withoutAd).toBeDefined();
    if (withAd === undefined || withoutAd === undefined) {
      return;
    }
    const renderStream = (node: BoxNode): string =>
      renderScreen({ id: "agent", title: "s", children: [node] }, { width: 80, color: false }).join("\n");
    expect(renderStream(withAd)).toBe(renderStream(withoutAd));
  });

  it("stays parseable without colour", () => {
    const quota = buildQuotaDashboardScreen({
      plan: "free",
      countryCode: "US",
      timeZone: "UTC",
      hoursPerDay: 5,
      consumedSeconds: 3600,
      resetsAt: "2026-11-21T00:00:00.000Z",
      now: new Date("2026-11-20T20:00:00.000Z"),
      unlimitedModels: ["DeepSeek Chat"],
      meteredModels: ["Claude Sonnet 4"],
      ad: firstAd,
    });
    const plain = renderScreen(quota, { width: 80, color: false }).join("\n");
    expect(plain).not.toContain("\u001b[");
    expect(plain).toContain("█");
    expect(plain).toContain("Sponsored");
    expect(plain).toContain("Resets in 4h 0m");

    const colored = renderScreen(quota, { width: 80, color: true }).join("\n");
    expect(colored).toContain("\u001b[38;5;");
    expect(colored).toContain("█");
  });

  it("inspects registered folders and explains broken ones inline", async () => {
    const home = await mkdtemp(join(tmpdir(), "freebuff-inspect-"));
    const folder = await mkdtemp(join(tmpdir(), "freebuff-folder-"));
    try {
      const paths = resolveCliPaths({ FREEBUFF_HOME: home });
      const { project } = await addProject(paths, { path: folder });

      const empty = await inspectProject(project);
      expect(empty.ok).toBe(false);
      expect(empty.reason).toBe("empty folder");
      expect(empty.recovery).toContain("git init");

      await writeFile(join(folder, "main.ts"), "export const ok = true;\n", "utf8");
      const plain = await inspectProject(project);
      expect(plain.reason).toBe("not a git repository");

      await mkdir(join(folder, ".git"), { recursive: true });
      await writeFile(join(folder, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
      const repo = await inspectProject(project);
      expect(repo.ok).toBe(true);
      expect(repo.branch).toBe("main");

      const picker = buildProjectPickerScreen({
        projects: [
          { id: String(project.id), name: project.name, path: project.path, problem: empty.reason ?? "", recovery: empty.recovery },
        ],
        selected: 0,
      });
      expect(text(picker)).toContain("empty folder");
      expect(text(picker)).toContain("git init");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(folder, { recursive: true, force: true });
    }
  });
});
