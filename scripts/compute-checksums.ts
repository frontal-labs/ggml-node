/**
 * Downloads every registry source, computes its SHA-256 and size, reads the context length
 * from the GGUF metadata, and writes `src/registry/models.ts`.
 *
 * Run: `bun run registry:generate` (add `--keep` to keep the downloaded files in the cache).
 *
 * Each file is streamed to disk and hashed as it arrives. The hash must equal the
 * Hugging Face LFS etag for the same file, or the script fails. Downloads go to the
 * node-slm cache dir, one at a time, and are deleted afterwards unless `--keep` is set.
 */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readGgufFileInfo } from "node-llama-cpp";
import { isNodeSlmError } from "@/core/errors.js";
import { resolveCacheDir } from "@/registry/cache.js";
import { downloadFile } from "@/registry/download.js";
import { MODEL_SOURCES, type RegistrySource } from "@/registry/sources.js";

const OUTPUT = join(import.meta.dirname, "..", "src", "registry", "models.ts");
const keep = process.argv.includes("--keep");
const ETAG_PATTERN = /^[0-9a-f]{64}$/u;

interface Computed {
  architecture: string;
  contextLength: number;
  sha256: string;
  sizeBytes: number;
  source: RegistrySource;
  url: string;
}

function urlFor(source: RegistrySource): string {
  return `https://huggingface.co/${source.hfRepo}/resolve/main/${source.file}`;
}

interface LfsMetadata {
  sha256: string;
  sizeBytes: number;
}

/**
 * Reads the LFS SHA-256 and size that Hugging Face reports for a file. The download below
 * must hash to exactly this value, so a mismatch means the file or the registry entry is wrong.
 */
async function lfsMetadata(url: string): Promise<LfsMetadata> {
  // The LFS headers are on the first response, before the redirect to the CDN, so do not follow it.
  const res = await fetch(url, { method: "HEAD", redirect: "manual" });
  const etag = res.headers.get("x-linked-etag")?.replaceAll('"', "").toLowerCase();
  const size = Number(res.headers.get("x-linked-size"));
  if (!(etag && ETAG_PATTERN.test(etag) && Number.isFinite(size)) || size <= 0) {
    throw new Error(`${url} has no usable x-linked-etag / x-linked-size headers`);
  }
  return { sha256: etag, sizeBytes: size };
}

const MAX_ATTEMPTS = 6;

/**
 * Downloads with node-slm's resumable downloader. A dropped connection resumes from the partial file.
 * The downloader hashes the stream and rejects any file whose SHA-256 differs from the LFS value.
 */
async function downloadVerified(
  url: string,
  dest: string,
  meta: LfsMetadata,
  id: string,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // Retries run one at a time, so the attempt order and the progress output stay readable.
      // biome-ignore lint/performance/noAwaitInLoops: sequential by design
      await downloadFile({
        destPath: dest,
        onProgress: (received, total) => {
          if (process.stdout.isTTY) {
            process.stdout.write(`\r[${id}] ${received} / ${total}`);
          }
        },
        sha256: meta.sha256,
        sizeBytes: meta.sizeBytes,
        url,
      });
      if (process.stdout.isTTY) {
        process.stdout.write("\n");
      }
      return;
    } catch (err) {
      const retryable = isNodeSlmError(err) && err.code === "DOWNLOAD_FAILED";
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw err;
      }
      console.warn(`[${id}] attempt ${attempt} dropped (${err.message}); resuming`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function computeOne(source: RegistrySource, dir: string): Promise<Computed> {
  const url = urlFor(source);
  const dest = join(dir, source.file);
  console.log(`[${source.id}] downloading ${url}`);

  const meta = await lfsMetadata(url);
  await downloadVerified(url, dest, meta, source.id);

  const info = await readGgufFileInfo(dest, { readTensorInfo: false });
  const { architecture } = info.metadata.general;
  if (typeof architecture !== "string") {
    throw new Error(`[${source.id}] GGUF has no general.architecture`);
  }
  const contextLength = info.architectureMetadata.context_length;
  if (typeof contextLength !== "number") {
    throw new Error(`[${source.id}] GGUF has no ${architecture}.context_length`);
  }

  const sizeOnDisk = (await stat(dest)).size;
  if (sizeOnDisk !== meta.sizeBytes) {
    throw new Error(`[${source.id}] size mismatch on disk`);
  }
  if (!keep) {
    await rm(dest, { force: true });
  }

  console.log(`[${source.id}] sha256=${meta.sha256} size=${meta.sizeBytes} ctx=${contextLength}`);
  return {
    architecture,
    contextLength,
    sha256: meta.sha256,
    sizeBytes: meta.sizeBytes,
    source,
    url,
  };
}

function renderEntry(c: Computed): string {
  const s = c.source;
  return `  "${s.id}": {
    id: "${s.id}",
    displayName: ${JSON.stringify(s.displayName)},
    hfRepo: "${s.hfRepo}",
    file: "${s.file}",
    url: "${c.url}",
    sha256: "${c.sha256}",
    sizeBytes: ${c.sizeBytes},
    contextLength: ${c.contextLength},
    license: "${s.license}",
    licenseUrl: "${s.licenseUrl}",
    // Heuristic: weights plus about 20% for the KV cache and runtime at the default context.
    ramEstimateBytes: ${Math.ceil(c.sizeBytes * 1.2)},
    notes: ${JSON.stringify(s.notes)},
  },`;
}

function render(computed: Computed[]): string {
  return `// Generated by scripts/compute-checksums.ts from src/registry/sources.ts. Do not edit by hand.
// Run \`bun run registry:generate\` to refresh it.

export const MODELS = {
${computed.map(renderEntry).join("\n")}
} as const;

export type ModelId = keyof typeof MODELS;

export type ModelEntry = (typeof MODELS)[ModelId];

export const MODEL_IDS = Object.keys(MODELS) as ModelId[];
`;
}

async function main(): Promise<void> {
  const dir = join(resolveCacheDir({}), ".generate");
  await mkdir(dir, { recursive: true });

  const computed: Computed[] = [];
  for (const source of MODEL_SOURCES) {
    // biome-ignore lint/performance/noAwaitInLoops: one model at a time keeps disk use low
    computed.push(await computeOne(source, dir));
  }
  await writeFile(OUTPUT, render(computed));
  console.log(`wrote ${OUTPUT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
