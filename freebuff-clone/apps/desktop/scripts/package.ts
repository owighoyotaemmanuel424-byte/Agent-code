import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/**
 * Builds an unsigned, self-contained desktop binary for the host platform with
 * `bun build --compile`. Signing and notarization need operator-owned Apple /
 * Microsoft certificates; this script stops at an unsigned artifact and prints
 * the exact signing commands that remain.
 */
const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");

const targets: Readonly<Record<string, string>> = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "win32-x64": "bun-windows-x64",
};

const main = async (): Promise<void> => {
  const platformKey = `${process.platform}-${process.arch}`;
  const target = targets[platformKey];
  if (target === undefined) {
    process.stderr.write(
      `No packaging target for ${platformKey}. Supported: ${Object.keys(targets).join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(dist, { recursive: true });
  const outfile = join(
    dist,
    `${basename("freebuff-desktop")}-${platformKey}${process.platform === "win32" ? ".exe" : ""}`,
  );

  const result = Bun.spawnSync(
    [
      "bun",
      "build",
      "--compile",
      `--target=${target}`,
      "--minify",
      "--outfile",
      outfile,
      join(root, "src", "server.ts"),
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode ?? 1;
    return;
  }

  const bytes = await readFile(outfile);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(`${outfile}.sha256`, `${digest}  ${basename(outfile)}\n`, "utf8");

  process.stdout.write(
    [
      `Built ${outfile}`,
      `sha256 ${digest}`,
      "",
      "UNSIGNED ARTIFACT. To ship it:",
      "  macOS: codesign --deep --options runtime --sign 'Developer ID Application: …' <binary>",
      "         xcrun notarytool submit <binary> --keychain-profile <profile> --wait",
      "         xcrun stapler staple <binary>",
      "  Windows: signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a <binary>",
      "",
      "Both require certificates this build does not have.",
      "",
    ].join("\n"),
  );
};

await main();
