import type { OpenNextConfig } from "@opennextjs/cloudflare";

const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: "cloudflare-node",
      converter: "edge",
      proxyExternalRequest: "fetch",
      incrementalCache: "dummy",
      queue: "dummy",
      tagCache: "dummy",
    },
  },
  edgeExternals: ["node:crypto"],
};

export default config;
