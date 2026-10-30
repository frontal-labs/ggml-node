import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { freemem } from "node:os";
import { promisify } from "node:util";
import { LocalLLMError } from "@/core/errors.js";

/** The attention shape that determines KV-cache size. Read from the GGUF metadata. */
export interface KvShape {
  blockCount: number;
  headCountKv: number;
  keyLength: number;
  valueLength: number;
}

/** Bytes per cached element. f16 is the default KV type in llama.cpp. */
const KV_BYTES_PER_ELEMENT = 2;

/**
 * Estimated KV-cache bytes for `sequences` sequences of `contextSize` tokens each.
 * Layers × KV heads × (key + value dims) × tokens × bytes, per sequence.
 */
export function estimateKvBytes(shape: KvShape, contextSize: number, sequences: number): number {
  return (
    shape.blockCount *
    shape.headCountKv *
    (shape.keyLength + shape.valueLength) *
    contextSize *
    KV_BYTES_PER_ELEMENT *
    sequences
  );
}

/**
 * Estimated resident size of a loaded model: the weights (file size) plus the KV cache.
 * Runtime buffers are not included. The estimate is conservative in the direction that matters
 * (it may overestimate slightly, but it does not hide an out-of-memory condition).
 */
export function estimateModelBytes(
  fileSizeBytes: number,
  shape: KvShape,
  contextSize: number,
  sequences: number,
): number {
  return fileSizeBytes + estimateKvBytes(shape, contextSize, sequences);
}

export interface MemoryReaders {
  /** Memory the system can hand out without swapping. See `readAvailableSystemBytes`. */
  availableSystemBytes: () => Promise<number>;
  cgroupCurrentBytes: () => Promise<number | undefined>;
  /** Linux cgroup v2 limit, or `undefined` when not in a cgroup with a limit. */
  cgroupLimitBytes: () => Promise<number | undefined>;
}

export const nodeMemoryReaders: MemoryReaders = {
  availableSystemBytes: () => readAvailableSystemBytes(),
  cgroupCurrentBytes: () => readCgroupNumber("/sys/fs/cgroup/memory.current"),
  cgroupLimitBytes: () => readCgroupNumber("/sys/fs/cgroup/memory.max"),
};

const run = promisify(execFile);

const MEM_AVAILABLE = /MemAvailable:\s+(?<kb>\d+) kB/u;
const VM_PAGE_SIZE = /page size of (?<bytes>\d+) bytes/u;
const VM_PAGE_COUNT = /Pages (?<name>free|inactive|speculative):\s+(?<count>\d+)\./gu;
/** Pages the kernel can reclaim without swapping, as `vm_stat` reports them. */
const AVAILABLE_PAGE_KINDS = ["free", "inactive", "speculative"] as const;

/**
 * Memory available without swapping. `os.freemem()` is not enough: on macOS it counts only
 * truly free pages and misses reclaimable file cache, so it reports far too little.
 *
 * - Linux: `MemAvailable` from /proc/meminfo, which the kernel computes for this purpose.
 * - macOS: free + inactive + speculative pages from `vm_stat`.
 * - Elsewhere, or if the read fails: `os.freemem()`.
 */
export async function readAvailableSystemBytes(): Promise<number> {
  try {
    if (process.platform === "linux") {
      const meminfo = await readFile("/proc/meminfo", "utf8");
      const kb = MEM_AVAILABLE.exec(meminfo)?.groups?.kb;
      if (kb) {
        return Number(kb) * 1024;
      }
    }
    if (process.platform === "darwin") {
      const { stdout } = await run("vm_stat");
      const pageSize = Number(VM_PAGE_SIZE.exec(stdout)?.groups?.bytes);
      const counts = new Map<string, number>();
      for (const match of stdout.matchAll(VM_PAGE_COUNT)) {
        counts.set(match.groups?.name ?? "", Number(match.groups?.count));
      }
      const pages = AVAILABLE_PAGE_KINDS.reduce((sum, kind) => sum + (counts.get(kind) ?? 0), 0);
      if (pageSize > 0 && pages > 0) {
        return pages * pageSize;
      }
    }
  } catch {
    // Fall through to os.freemem().
  }
  return freemem();
}

async function readCgroupNumber(path: string): Promise<number | undefined> {
  try {
    const raw = (await readFile(path, "utf8")).trim();
    if (raw === "max") {
      return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Memory this process can still use: free system memory, or the cgroup headroom when smaller. */
export async function availableMemoryBytes(
  readers: MemoryReaders = nodeMemoryReaders,
): Promise<number> {
  const system = await readers.availableSystemBytes();
  const limit = await readers.cgroupLimitBytes();
  if (limit === undefined) {
    return system;
  }
  const current = (await readers.cgroupCurrentBytes()) ?? 0;
  return Math.min(system, Math.max(0, limit - current));
}

export interface PreflightInput {
  contextSize: number;
  estimateBytes: number;
  readers?: MemoryReaders;
  sequences: number;
}

/** Throws `OUT_OF_MEMORY` when the estimate exceeds what is available. */
export async function preflight(input: PreflightInput): Promise<void> {
  const available = await availableMemoryBytes(input.readers);
  if (input.estimateBytes <= available) {
    return;
  }
  throw new LocalLLMError(
    "OUT_OF_MEMORY",
    `Model needs about ${gib(input.estimateBytes)} GB but only ${gib(available)} GB is available`,
    {
      hint: `Use a smaller model, or lower contextSize (now ${input.contextSize}) or maxConcurrency (now ${input.sequences}).`,
    },
  );
}

function gib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2);
}
