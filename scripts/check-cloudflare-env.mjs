import { readFileSync } from "node:fs";

const wrangler = readFileSync("wrangler.jsonc", "utf8");
const required = [
  ["FILES", '"r2_buckets"'],
  ["KNOWLEDGE_INDEX", '"vectorize"'],
  ["DOCUMENT_QUEUE", '"queues"'],
];

for (const [binding, section] of required) {
  if (!wrangler.includes(section) || !wrangler.includes(`"binding": "${binding}"`)) {
    throw new Error(`Missing Cloudflare binding: ${binding}`);
  }
}

if (!wrangler.includes('"main": ".open-next/worker.js"')) {
  throw new Error("Wrangler main must point to .open-next/worker.js");
}

if (!wrangler.includes('"directory": ".open-next/assets"')) {
  throw new Error("Wrangler assets directory must point to .open-next/assets");
}

console.log("Cloudflare bindings and OpenNext configuration look consistent.");
