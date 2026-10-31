#!/usr/bin/env node
// Measures an embedding model: load time, single-text latency, batch throughput and peak resident
// memory. Run after `bun run build`, because it imports the built package.
//
// Usage: node scripts/bench-embedding.mjs <registry id or path to a .gguf> [--batch 64] [--runs 5]
// Prints one JSON object. Each run is a fresh process, so run it several times for a table.
import { createGgmlNode } from "../dist/index.js";

const TOPICS = [
  "rivers",
  "quarterly revenue",
  "gardening in clay soil",
  "train schedules",
  "medieval castles",
  "API rate limits",
  "sourdough starters",
  "solar panel output",
];

const args = process.argv.slice(2);
const [model] = args;
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : Number(args[at + 1]);
};
if (!model) {
  console.error("usage: node scripts/bench-embedding.mjs <model> [--batch 64] [--runs 5]");
  process.exit(1);
}
const batchSize = flag("--batch", 64);
const runs = flag("--runs", 5);

/** Deterministic, distinct sentences, so the batch is not one repeated input. */
const sentence = (i) => `Note ${i} about ${TOPICS[i % TOPICS.length]} and the week ${i * 7}.`;
const batch = Array.from({ length: batchSize }, (_, i) => sentence(i));
const single = sentence(0);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const node = createGgmlNode({ model: model.endsWith(".gguf") ? { path: model } : model });
let peak = process.memoryUsage().rss;
const sampler = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 50);

try {
  const loadStarted = performance.now();
  const info = await node.ready();
  const loadMs = performance.now() - loadStarted;
  await node.embed({ input: single });

  const singleMs = [];
  for (let i = 0; i < 10; i += 1) {
    const started = performance.now();
    // biome-ignore lint/performance/noAwaitInLoops: each call is timed on its own
    await node.embed({ input: single });
    singleMs.push(performance.now() - started);
  }

  const batchMs = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    // biome-ignore lint/performance/noAwaitInLoops: runs are timed one after another
    const result = await node.embed({ input: batch });
    batchMs.push(performance.now() - started);
    if (result.embeddings.length !== batchSize) {
      throw new Error("the batch returned the wrong number of vectors");
    }
  }
  peak = Math.max(peak, process.memoryUsage().rss);

  const batchMedian = median(batchMs);
  console.log(
    JSON.stringify({
      batchMedianMs: Math.round(batchMedian),
      batchSize,
      dimensions: info.dimensions,
      loadMs: Math.round(loadMs),
      model: info.id,
      peakRssMb: Math.round(peak / 1024 / 1024),
      singleMedianMs: Math.round(median(singleMs) * 10) / 10,
      textsPerSecond: Math.round((batchSize / batchMedian) * 1000 * 10) / 10,
    }),
  );
} finally {
  clearInterval(sampler);
  await node.unload();
}
