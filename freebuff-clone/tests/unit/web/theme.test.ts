import { describe, expect, it } from "vitest";
import { webThemeCss } from "@freebuff/shared";
import { builderHtml } from "../../../apps/web/src/ui";
import { dashboardHtml } from "../../../apps/cloud/src/dashboard";

describe("web surfaces share the terminal palette", () => {
  it("interpolates the shared token block into the builder page", () => {
    const html = builderHtml({ modelReady: true });
    expect(html).toContain(webThemeCss());
    expect(html).toContain("--accent: #7c8cff;");
    expect(html).toContain("--surface: #07090f;");
    expect(html).toContain("--bg: var(--surface);");
    expect(html).not.toContain("--accent: #7c8cff;\n    --accent-2");
  });

  it("interpolates the same block into the cloud dashboard", () => {
    const html = dashboardHtml({
      providerName: "docker",
      previewHint: "Ports 3001+ are published on the loopback interface.",
    });
    expect(html).toContain(webThemeCss());
    expect(html).toContain("--sponsored: #9aa5b8;");
    expect(html).toContain("--text: var(--text-primary);");
  });
});
