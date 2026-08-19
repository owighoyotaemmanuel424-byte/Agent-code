import type { OpenNextConfig } from "@opennextjs/cloudflare";

const override = {
  wrapper: "cloudflare-node" as const,
  converter: "edge" as const,
  proxyExternalRequest: "fetch" as const,
  incrementalCache: "dummy" as const,
  tagCache: "dummy" as const,
  queue: "dummy" as const,
};

const config: OpenNextConfig = {
  default: { override },
  edgeExternals: ["node:crypto"],
  middleware: {
    external: true,
    override: {
      ...override,
      wrapper: "cloudflare-edge",
    },
  },
};

export default config;
