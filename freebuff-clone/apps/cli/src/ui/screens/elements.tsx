/** @jsxImportSource @opentui/react */
import { AppError, glyphs, roleHex } from "@freebuff/shared";
import type { ThemeRole } from "@freebuff/shared";
import { formatSponsoredAd } from "@freebuff/ads";
import type { ReactNode } from "react";
import { AD_ROW_HEIGHT } from "./types";
import type { AdNode, BoxNode, ListNode, Screen, ScreenNode } from "./types";

export const colorOf = (role: ThemeRole): string => roleHex(role);

const adError = (message: string): never => {
  throw new AppError({ code: "validation_failed", message });
};

/** The only component that renders a sponsored slot. Refuses unlabelled ads. */
export const AdRow = ({ node }: { readonly node: AdNode }): ReactNode => {
  if (node.ad.label !== "Sponsored") {
    return adError("Sponsored slot rendered without its literal label");
  }
  if (node.height !== AD_ROW_HEIGHT) {
    return adError("Sponsored slot must use the reserved height");
  }
  const lines = formatSponsoredAd(node.ad);
  return (
    <box
      border
      borderStyle="rounded"
      title="Sponsored"
      height={AD_ROW_HEIGHT}
      style={{ flexDirection: "column", paddingLeft: 1, paddingRight: 1, flexShrink: 0 }}
    >
      {lines.map((line, index) => (
        <text key={String(index)} fg={colorOf("sponsored")}>
          {line}
        </text>
      ))}
    </box>
  );
};

const listRows = (node: ListNode): readonly ReactNode[] => {
  const rows: ReactNode[] = [];
  let index = 0;
  for (const group of node.groups) {
    rows.push(
      <text key={`group-${group.label}`} fg={colorOf("text-muted")}>
        {group.label}
      </text>,
    );
    for (const item of group.items) {
      const selected = index === node.selected;
      const content = `${selected ? glyphs.cursor : " "} ${item.label}${
        item.detail === undefined ? "" : `  ${item.detail}`
      }`;
      rows.push(
        <text key={item.id} fg={colorOf(item.role)}>
          {selected ? <strong>{content}</strong> : content}
        </text>,
      );
      index += 1;
    }
  }
  return rows;
};

/** Raw elements for one node; exported so tests can walk the component tree. */
export const nodeElement = (node: ScreenNode): ReactNode => {
  switch (node.kind) {
    case "text":
      return (
        <text key={node.id} fg={colorOf(node.role)}>
          {node.emphasis === "dim" ? <em>{node.content}</em> : node.content}
        </text>
      );
    case "list":
      return (
        <box
          key={node.id}
          height={node.height}
          style={{ flexDirection: "column", flexShrink: 0 }}
        >
          {listRows(node)}
        </box>
      );
    case "box":
      return (
        <box
          key={node.id}
          border={node.border !== false}
          borderStyle="rounded"
          title={node.title}
          height={node.height}
          style={{
            flexDirection: "column",
            flexGrow: node.flexGrow === true ? 1 : 0,
            flexShrink: node.flexGrow === true ? 1 : 0,
            paddingLeft: node.border === false ? 0 : 1,
            paddingRight: node.border === false ? 0 : 1,
          }}
        >
          {node.children.map((child) => nodeElement(child))}
        </box>
      );
    case "ad":
      return <AdRow key={node.id} node={node} />;
  }
};

/** Children of the stream box. An ad here is a hard failure (design rule R1). */
export const streamElements = (node: BoxNode): readonly ReactNode[] => {
  if (node.region !== "stream") {
    return adError("streamElements only renders a stream region");
  }
  return node.children.map((child) => {
    if (child.kind === "ad") {
      return adError("A sponsored slot cannot render inside the agent stream");
    }
    return nodeElement(child);
  });
};

export const StreamView = ({ node }: { readonly node: BoxNode }): ReactNode => (
  <scrollbox focused style={{ flexGrow: 1, flexShrink: 1 }}>
    <box style={{ flexDirection: "column" }}>{streamElements(node)}</box>
  </scrollbox>
);

/** Static screens (picker, auth, quota) share one column layout. */
export const StaticScreen = ({ screen }: { readonly screen: Screen }): ReactNode => (
  <box style={{ flexDirection: "column", flexGrow: 1 }}>{screen.children.map((node) => nodeElement(node))}</box>
);
