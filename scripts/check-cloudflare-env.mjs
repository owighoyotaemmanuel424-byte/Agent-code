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

if (!wrangler.includes('"main": "cloudflare-worker.ts"')) {
  throw new Error("Wrangler main must point to cloudflare-worker.ts");
}

console.log("Cloudflare bindings configuration looks consistent.");
