import type { StreamLine } from "./sessions";

/**
 * The platform streams NDJSON build events; a tile only ever stores rows. Keep
 * the parser total: an unknown or malformed line is ignored instead of being
 * rendered, so a hostile or newer producer cannot inject markup into a tile.
 */
export type BuildStreamEvent =
  | { readonly type: "step"; readonly step: string; readonly status: string; readonly detail?: string }
  | { readonly type: "done"; readonly url: string; readonly app: { readonly id: string; readonly name: string } }
  | { readonly type: "error"; readonly message: string };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const parseStreamEvent = (line: string): BuildStreamEvent | undefined => {
  if (line.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  if (record === undefined) return undefined;
  const type = text(record["type"]);
  if (type === "step") {
    const step = text(record["step"]);
    const status = text(record["status"]) ?? "ok";
    if (step === undefined) return undefined;
    const detail = text(record["detail"]);
    return detail === undefined ? { type, step, status } : { type, step, status, detail };
  }
  if (type === "done") {
    const url = text(record["url"]);
    const app = asRecord(record["app"]);
    const id = app === undefined ? undefined : text(app["id"]);
    if (url === undefined || app === undefined || id === undefined) return undefined;
    return { type, url, app: { id, name: text(app["name"]) ?? id } };
  }
  if (type === "error") {
    return { type, message: text(record["message"]) ?? "Build failed" };
  }
  return undefined;
};

const eventStatus = (status: string): "ok" | "failed" => {
  const value = status.toLowerCase();
  return value === "failed" || value === "error" ? "failed" : "ok";
};

/** A stream event becomes exactly one row; `done` and `error` are rows too. */
export const streamEventToLine = (
  event: BuildStreamEvent,
): StreamLine | undefined => {
  switch (event.type) {
    case "step":
      return {
        step: event.step,
        status: eventStatus(event.status),
        detail: event.detail ?? "",
      };
    case "done":
      return { step: "deployed", status: "ok", detail: event.url };
    case "error":
      return { step: "error", status: "failed", detail: event.message };
  }
};

/** Splits a chunked body into complete lines, returning the trailing partial. */
export const splitLines = (
  buffer: string,
): { readonly lines: readonly string[]; readonly rest: string } => {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
};
