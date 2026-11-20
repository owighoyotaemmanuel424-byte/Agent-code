import { FreebuffClient } from "@freebuff/sdk";
import { createDesktopApp } from "./app";

const platformUrl = process.env["FREEBUFF_PLATFORM_URL"] ?? "http://127.0.0.1:3002";
const token = process.env["FREEBUFF_SESSION_TOKEN"];

const client = new FreebuffClient({
  baseUrl: platformUrl,
  ...(token === undefined || token.length === 0 ? {} : { token }),
});

/** The platform streams NDJSON; the shell pipes it straight into a tile. */
const buildStream = async (prompt: string): Promise<Response> =>
  fetch(`${platformUrl}/api/apps/build`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined || token.length === 0
        ? {}
        : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ prompt }),
  });

const app = createDesktopApp({
  client,
  platformUrl,
  buildStream,
  sessionId: process.env["FREEBUFF_DESKTOP_SESSION"] ?? "desktop-local",
});

const port = Number.parseInt(process.env["PORT"] ?? "3100", 10);
const hostname = process.env["FREEBUFF_DESKTOP_HOST"] ?? "127.0.0.1";
const server = Bun.serve({ port, hostname, fetch: app.fetch });

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
