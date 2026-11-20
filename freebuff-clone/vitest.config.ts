import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageEntry = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const alias: Record<string, string> = {
  "@freebuff/shared": packageEntry("shared"),
  "@freebuff/llm-providers": packageEntry("llm-providers"),
  "@freebuff/code-map": packageEntry("code-map"),
  "@freebuff/agent-runtime": packageEntry("agent-runtime"),
  "@freebuff/quota": packageEntry("quota"),
  "@freebuff/auth": packageEntry("auth"),
  "@freebuff/ads": packageEntry("ads"),
  "@freebuff/sandbox-orchestrator": packageEntry("sandbox-orchestrator"),
  "@freebuff/db": packageEntry("db"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/**/src/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**", "tests/load/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
    },
  },
});
