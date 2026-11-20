import { describe, expect, it } from "vitest";
import { timelineHtml, timelineSteps } from "../../../apps/cloud/src/timeline";

describe("sandbox status timeline", () => {
  it("marks exactly one running step while provisioning", () => {
    const creating = timelineSteps("creating");
    expect(creating).toHaveLength(5);
    expect(creating.filter((step) => step.state === "active")).toHaveLength(1);
    expect(creating[0]).toMatchObject({ id: "provisioning", label: "provisioning", state: "active" });

    const cloning = timelineSteps("cloning");
    expect(cloning[0]?.state).toBe("done");
    expect(cloning[1]).toMatchObject({ id: "cloning", state: "active" });

    const installing = timelineSteps("installing");
    expect(installing.slice(0, 2).map((step) => step.state)).toEqual(["done", "done"]);
    expect(installing[2]).toMatchObject({ id: "installing", state: "active" });

    const starting = timelineSteps("starting");
    expect(starting.slice(0, 3).map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(starting[3]).toMatchObject({ id: "starting", state: "active" });
  });

  it("stops moving once the sandbox is running", () => {
    const ready = timelineSteps("ready");
    expect(ready.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(ready.some((step) => step.state === "active")).toBe(false);
    expect(ready.at(-1)?.label).toBe("running");
  });

  it("reports a failure at the step that was running", () => {
    const failed = timelineSteps("failed", "install exited with code 1");
    expect(failed.filter((step) => step.state === "failed")).toHaveLength(1);
    expect(failed.some((step) => step.state === "active")).toBe(false);
    const marker = failed.find((step) => step.state === "failed");
    expect(marker?.label).toBe("failed");
    expect(marker?.detail).toBe("install exited with code 1");
  });

  it("appends a stopped step and keeps every other step settled", () => {
    const stopped = timelineSteps("stopped");
    expect(stopped).toHaveLength(6);
    expect(stopped.at(-1)).toMatchObject({ id: "stopped", label: "stopped", state: "done" });
    expect(stopped.some((step) => step.state === "active")).toBe(false);
  });

  it("renders the timeline with glyphs, not colour alone", () => {
    const html = timelineHtml({ phase: "installing" });
    expect(html).toContain('data-phase="installing"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="active"');
    expect(html).toContain('data-state="pending"');
    expect(html).toContain("✓");
    expect(html).toContain("▸");
    expect(html).toContain("○");
    const failed = timelineHtml({ phase: "failed", error: "boom <script>" });
    expect(failed).toContain("✗");
    expect(failed).toContain("boom &lt;script&gt;");
    expect(failed).not.toContain("<script>");
  });
});
