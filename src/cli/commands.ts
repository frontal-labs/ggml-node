import { readFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { isInboardError } from "@/core/errors.js";
import { nodeMemoryReaders, readAvailableSystemBytes } from "@/core/memory.js";
import type { GenerateResult, Inboard, InboardOptions, ModelInfo } from "@/core/types.js";
import { env as defaultEnv, type InboardEnv } from "@/env.js";
import { resolveCacheDir } from "@/registry/cache.js";
import { isModelPresent } from "@/registry/ensure.js";
import { MODELS, type ModelId } from "@/registry/models.js";

/** Commands that run inference. They take an injectable factory, so tests use the mock backend. */
export type InboardFactory = (options: InboardOptions) => Inboard;

export interface BenchResult {
  firstTokenMs: number;
  gpu: ModelInfo["gpu"];
  loadMs: number;
  model: ModelId;
  peakRssBytes: number;
  tokens: number;
  tokensPerSecond: number;
  totalMs: number;
}

export interface DoctorCheck {
  detail: string;
  /** What to run or change when the check is not ok. */
  fix?: string | undefined;
  name: string;
  status: "ok" | "warn" | "fail";
}

const BYTES_PER_GB = 1024 ** 3;
const gb = (bytes: number) => (bytes / BYTES_PER_GB).toFixed(1);

/** `inboard run`: one generation, or one structured object when a JSON Schema file is given. */
export const runOptionsSchema = z.object({
  json: z.boolean().default(false),
  jsonSchema: z.string().min(1).optional(),
  model: z.string().min(1).default("qwen2.5-0.5b"),
});

/** The text a run printed, plus the generation metadata. Structured runs print the object as JSON. */
export interface RunOutput {
  finishReason: GenerateResult["finishReason"];
  model: GenerateResult["model"];
  text: string;
  timing: GenerateResult["timing"];
  usage: GenerateResult["usage"];
}

export async function runPrompt(
  prompt: string,
  rawOptions: unknown,
  factory: InboardFactory,
  env: InboardEnv = defaultEnv,
): Promise<RunOutput> {
  const options = runOptionsSchema.parse(rawOptions);
  const model = options.model as ModelId;
  const ai = factory({ model, ...cacheOption(env) });
  try {
    if (options.jsonSchema) {
      const schema = JSON.parse(await readFile(options.jsonSchema, "utf8")) as Record<
        string,
        unknown
      >;
      const r = await ai.object({ prompt, schema, temperature: 0 });
      return {
        finishReason: r.finishReason,
        model: r.model,
        text: JSON.stringify(r.object),
        timing: r.timing,
        usage: r.usage,
      };
    }
    const result = await ai.generate({ maxTokens: 256, prompt });
    return {
      finishReason: result.finishReason,
      model: result.model,
      text: result.text,
      timing: result.timing,
      usage: result.usage,
    };
  } finally {
    await ai.unload();
  }
}

/** `inboard bench`: load time, first token, tokens per second, and peak resident memory. */
export async function benchModel(
  modelId: ModelId,
  tokens: number,
  factory: InboardFactory,
  env: InboardEnv = defaultEnv,
): Promise<BenchResult> {
  const ai = factory({ model: modelId, ...cacheOption(env) });
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 50);
  try {
    const loadStart = performance.now();
    const info = await ai.ready();
    const loadMs = performance.now() - loadStart;
    const r = await ai.generate({
      maxTokens: tokens,
      prompt: "Describe a river in detail.",
      temperature: 0,
    });
    peak = Math.max(peak, process.memoryUsage().rss);
    return {
      firstTokenMs: r.timing.firstTokenMs,
      gpu: info.gpu,
      loadMs,
      model: modelId,
      peakRssBytes: peak,
      tokens: r.usage.outputTokens,
      tokensPerSecond: r.timing.tokensPerSecond,
      totalMs: r.timing.totalMs,
    };
  } finally {
    clearInterval(sampler);
    await ai.unload();
  }
}

/** `inboard doctor`: each check reports ok, warn or fail, and a failure says how to fix it. */
export async function doctor(
  factory: InboardFactory,
  env: InboardEnv = defaultEnv,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push({
    detail: `${platform()} ${release()} ${arch()}, Node ${process.version}`,
    name: "platform",
    status: "ok",
  });
  const cpu = cpus()[0]?.model ?? "unknown CPU";
  checks.push({ detail: `${cpu}, ${cpus().length} logical cores`, name: "cpu", status: "ok" });

  const available = await readAvailableSystemBytes();
  const ramOk = available >= 2 * BYTES_PER_GB;
  checks.push({
    detail: `${gb(available)} GB available of ${gb(totalmem())} GB`,
    fix: ramOk
      ? undefined
      : "Close other applications, or use a smaller model such as smollm2-360m.",
    name: "memory",
    status: ramOk ? "ok" : "warn",
  });
  const cgroup = await nodeMemoryReaders.cgroupLimitBytes();
  if (cgroup !== undefined) {
    checks.push({ detail: `container limit ${gb(cgroup)} GB`, name: "cgroup", status: "ok" });
  }

  const cacheDir = resolveCacheDir({ env });
  const writable = await canWrite(cacheDir);
  checks.push({
    detail: cacheDir,
    fix: writable
      ? undefined
      : "Make the directory writable, or set INBOARD_CACHE_DIR to a writable path.",
    name: "cache dir",
    status: writable ? "ok" : "fail",
  });

  const defaultEntry = MODELS["qwen2.5-0.5b"];
  const cached = await isModelPresent(defaultEntry, cacheDir);
  checks.push({
    detail: cached
      ? `${defaultEntry.displayName} is cached`
      : `${defaultEntry.displayName} is not cached`,
    fix: cached ? undefined : "Run: npx inboard pull qwen2.5-0.5b",
    name: "default model",
    status: cached ? "ok" : "warn",
  });

  if (cached) {
    try {
      const ai = factory({ model: "qwen2.5-0.5b", ...cacheOption(env) });
      const info = await ai.ready();
      await ai.generate({ maxTokens: 4, prompt: "Say ok.", temperature: 0 });
      await ai.unload();
      checks.push({
        detail: `backend loaded and generated (gpu: ${info.gpu})`,
        name: "backend",
        status: "ok",
      });
    } catch (err) {
      checks.push({
        detail: describe(err),
        fix: isInboardError(err) ? err.hint : "Run the command again with a fresh process.",
        name: "backend",
        status: "fail",
      });
    }
  }
  return checks;
}

export function doctorExitCode(checks: readonly DoctorCheck[]): number {
  return checks.some((c) => c.status === "fail") ? 2 : 0;
}

function cacheOption(env: InboardEnv): { cacheDir?: string } {
  const dir = resolveCacheDir({ env });
  return { cacheDir: dir };
}

async function canWrite(dir: string): Promise<boolean> {
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  try {
    await mkdir(dir, { recursive: true });
    const probe = join(dir, `.write-test-${process.pid}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function describe(err: unknown): string {
  if (isInboardError(err)) {
    return `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
