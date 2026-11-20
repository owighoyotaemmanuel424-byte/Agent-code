import { FreebuffClient } from "@freebuff/sdk";
import { createDesktopApp } from "./app";

const platformUrl = process.env["FREEBUFF_PLATFORM_URL"] ?? "http://127.0.0.1:3002";
const token = process.env["FREEBUFF_SESSION_TOKEN"];

const client = new FreebuffClient({
  baseUrl: platformUrl,
  ...(token === undefined || token.length === 0 ? {} : { token }),
});

const app = createDesktopApp({
  client,
  platformUrl,
  sessionId: process.env["FREEBUFF_DESKTOP_SESSION"] ?? "desktop-local",
});

const port = Number.parseInt(process.env["PORT"] ?? "3100", 10);
const server = Bun.serve({ port, hostname: "127.0.0.1", fetch: app.fetch });

const localUrl = `http://127.0.0.1:${String(server.port)}/`;
process.stdout.write(
  `freebuff desktop shell on ${localUrl} (platform: ${platformUrl}${token === undefined ? ", signed out" : ""})\n`,
);

if (process.env["FREEBUFF_DESKTOP_OPEN"] === "1") {
  const command =
    process.platform === "darwin"
      ? ["open", localUrl]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", localUrl]
        : ["xdg-open", localUrl];
  Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
}
