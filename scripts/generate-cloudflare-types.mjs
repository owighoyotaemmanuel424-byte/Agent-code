import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync("src/generated", { recursive: true });

const result = spawnSync("npx", ["wrangler", "types", "src/generated/cloudflare-env.d.ts"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) process.exit(result.status ?? 1);
