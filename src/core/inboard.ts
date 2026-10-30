import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { type ModelMeta, readModelMeta } from "../backend/gguf-meta.js";
import { createLlamaCppBackend } from "../backend/llama-cpp.js";
import type { Backend, BackendRequest, BackendResult, JsonGrammar } from "../backend/types.js";
import { resolveCacheDir, resolveOffline } from "../registry/cache.js";
import { ensureModel } from "../registry/ensure.js";
import { MODEL_IDS, MODELS, type ModelId } from "../registry/models.js";
import { AsyncChannel } from "./channel.js";
import { InboardError, isInboardError } from "./errors.js";
import { emitEvent } from "./events.js";
import { estimateModelBytes, type MemoryReaders, nodeMemoryReaders, preflight } from "./memory.js";
import { fitToBudget, type NormalizedRequest, normalizeRequest } from "./prompt.js";
import { abortedError, Scheduler } from "./scheduler.js";
import {
  assertSupportedSchema,
  isZodLike,
  schemaViolation,
  withSchemaInstruction,
  zodToJsonSchema,
} from "./structured.js";
import type {
  GenerateOptions,
  GenerateResult,
  Inboard,
  InboardOptions,
  JsonSchemaObject,
  ModelInfo,
  ObjectOptions,
  ObjectResult,
  StreamResult,
  ZodLikeSchema,
} from "./types.js";

const DEFAULT_CONTEXT_CAP = 4096;

/** Injection points. Production uses the defaults. Tests pass a fake backend and fixed metadata. */
export interface InboardDeps {
  createBackend: () => Backend;
  readMeta: (path: string) => Promise<ModelMeta>;
  memory: MemoryReaders;
  /** Overrides the environment for offline and cache dir resolution. Defaults to process.env. */
  env: NodeJS.ProcessEnv;
}

export const defaultDeps: InboardDeps = {
  createBackend: createLlamaCppBackend,
  readMeta: readModelMeta,
  memory: nodeMemoryReaders,
  env: process.env,
};

interface Loaded {
  backend: Backend;
  info: ModelInfo;
  scheduler: Scheduler;
}

interface RunSpec {
  req: NormalizedRequest;
  requestId: string;
  signal?: AbortSignal | undefined;
  onDelta?: ((text: string) => void) | undefined;
  /** When set, generation is constrained to this schema and the output is parsed against it. */
  jsonSchema?: JsonSchemaObject | undefined;
  schemaName?: string | undefined;
}

interface RunOutcome {
  result: GenerateResult;
  grammar: JsonGrammar | undefined;
}

/** Creates an in-process inference handle. Models load lazily on first use, or on `ready()`. */
export function createInboard(options: InboardOptions): Inboard {
  return createInboardWithDeps(options, defaultDeps);
}

/** `createInboard` with injectable dependencies. Used by `inboard/testing` and the unit tests. */
export function createInboardWithDeps(options: InboardOptions, deps: InboardDeps): Inboard {
  validateOptions(options);

  const id: ModelId | "custom" = typeof options.model === "string" ? options.model : "custom";
  const isolation = options.isolation ?? "none";
  if (isolation === "process") {
    throw new InboardError("INVALID_OPTIONS", 'isolation: "process" is not available yet', {
      hint: 'Use isolation: "none" for now. Process isolation lands in a later milestone.',
    });
  }
  const offline = resolveOffline(options.offline, deps.env);
  const cacheDir = resolveCacheDir({ cacheDir: options.cacheDir, env: deps.env });
  const maxConcurrency = options.maxConcurrency ?? 1;
  const maxQueue = options.maxQueue ?? 64;
  const threads =
    options.threads === "auto" || options.threads === undefined ? undefined : options.threads;
  const gpu = options.gpu ?? "auto";
  const autoDownload = options.autoDownload ?? true;
  const acceptLicense = options.acceptLicense ?? false;
  const onEvent = options.onEvent;

  let loaded: Loaded | undefined;
  let loading: Promise<Loaded> | undefined;
  let unloading: Promise<void> | undefined;
  let requestCounter = 0;

  async function loadModel(): Promise<Loaded> {
    const backend = deps.createBackend();
    const modelLabel: ModelId | "custom" = id;
    emitEvent(onEvent, { type: "load:start", model: modelLabel });
    const started = performance.now();

    let path: string;
    let license: string;
    let contextCap: number;
    if (typeof options.model === "string") {
      const entry = MODELS[options.model];
      license = entry.license;
      contextCap = entry.contextLength;
      path = await ensureModel(options.model, {
        cacheDir,
        allowDownload: !offline && autoDownload,
        offline,
        acceptLicense,
        onEvent: (e) => emitEvent(onEvent, e),
      });
    } else {
      path = resolve(options.model.path);
      license = "unknown";
      contextCap = Number.POSITIVE_INFINITY;
      await assertExists(path);
    }

    const meta = await deps.readMeta(path);
    const contextSize =
      options.contextSize ??
      Math.min(Math.min(contextCap, meta.trainContextSize), DEFAULT_CONTEXT_CAP);
    if (!Number.isInteger(contextSize) || contextSize < 1) {
      throw new InboardError("INVALID_OPTIONS", "contextSize must be a positive integer", {
        hint: "Set contextSize to a whole number, or leave it unset.",
      });
    }

    await preflight({
      estimateBytes: estimateModelBytes(meta.sizeBytes, meta.shape, contextSize, maxConcurrency),
      contextSize,
      sequences: maxConcurrency,
      readers: deps.memory,
    });

    try {
      const backendInfo = await backend.load({
        path,
        contextSize,
        sequences: maxConcurrency,
        ...(threads !== undefined ? { threads } : {}),
        gpu,
      });
      const info: ModelInfo = {
        id: modelLabel,
        path,
        sizeBytes: backendInfo.sizeBytes,
        contextSize: backendInfo.contextSize,
        license,
        backend: "llama-cpp",
        gpu: backendInfo.gpu,
      };
      const ms = performance.now() - started;
      emitEvent(onEvent, { type: "load:done", model: modelLabel, ms });
      return { backend, info, scheduler: new Scheduler({ sequences: maxConcurrency, maxQueue }) };
    } catch (err) {
      await backend.unload().catch(() => undefined);
      throw toInboardError(err);
    }
  }

  /** Loads the model once. Concurrent callers share the same load. Returns `loadMs: 0` when already loaded. */
  async function ensureLoaded(): Promise<{ state: Loaded; loadMs: number }> {
    if (unloading) await unloading;
    if (loaded) return { state: loaded, loadMs: 0 };
    const started = performance.now();
    loading ??= loadModel().then(
      (state) => {
        loaded = state;
        loading = undefined;
        return state;
      },
      (err: unknown) => {
        loading = undefined;
        throw err;
      },
    );
    const state = await loading;
    return { state, loadMs: performance.now() - started };
  }

  async function runRequest(spec: RunSpec): Promise<RunOutcome> {
    const { req, requestId, signal, onDelta, jsonSchema, schemaName } = spec;
    const started = performance.now();
    const { state, loadMs } = await ensureLoaded();
    const { backend, scheduler, info } = state;
    const budget = info.contextSize - req.maxTokens;
    if (budget <= 0) {
      throw new InboardError(
        "INVALID_OPTIONS",
        `maxTokens (${req.maxTokens}) must be less than contextSize (${info.contextSize})`,
        { hint: "Lower maxTokens or raise contextSize." },
      );
    }

    const grammar = jsonSchema ? await backend.buildJsonGrammar(jsonSchema) : undefined;
    const withInstruction =
      jsonSchema !== undefined
        ? withSchemaInstruction(req.messages, jsonSchema, schemaName)
        : req.messages;
    const messages = await fitToBudget(withInstruction, budget, req.overflow, (m) =>
      backend.countPromptTokens(m),
    );

    const lease = await scheduler.acquire(signal, (queueLength) =>
      emitEvent(onEvent, { type: "request:queued", id: requestId, queueLength }),
    );

    emitEvent(onEvent, { type: "request:start", id: requestId });
    let outcome: BackendResult;
    try {
      await backend.resetSequence(lease.index);
      const request: BackendRequest = {
        messages,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        ...(req.topP !== undefined ? { topP: req.topP } : {}),
        ...(req.topK !== undefined ? { topK: req.topK } : {}),
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
        ...(req.stop !== undefined ? { stop: req.stop } : {}),
        ...(signal ? { signal } : {}),
        ...(grammar ? { grammar } : {}),
      };
      outcome = await backend.generate(lease.index, request, (text) => onDelta?.(text));
    } catch (err) {
      throw toInboardError(err);
    } finally {
      lease.release();
    }

    const totalMs = performance.now() - started;
    const genMs = Math.max(totalMs - lease.queueMs, 1);
    const result: GenerateResult = {
      text: outcome.text,
      finishReason: outcome.finishReason,
      model: info.id,
      usage: outcome.usage,
      timing: {
        queueMs: lease.queueMs,
        loadMs,
        firstTokenMs: outcome.firstTokenMs,
        totalMs: totalMs + loadMs,
        tokensPerSecond: outcome.usage.outputTokens / (genMs / 1000),
      },
    };
    return { result, grammar };
  }

  async function generate(opts: GenerateOptions): Promise<GenerateResult> {
    const requestId = nextId();
    try {
      const req = normalizeRequest(opts);
      const { result } = await runRequest({ req, requestId, signal: opts.signal });
      if (result.finishReason === "abort") throw abortedError();
      emitEvent(onEvent, { type: "request:done", id: requestId, result: withoutText(result) });
      return result;
    } catch (err) {
      emitEvent(onEvent, { type: "request:error", id: requestId, error: toInboardError(err) });
      throw err;
    }
  }

  async function object(opts: ObjectOptions<unknown>): Promise<ObjectResult<unknown>> {
    const requestId = nextId();
    try {
      const { schema, schemaName, ...genOpts } = opts;
      const zodSchema = isZodLike(schema) ? schema : undefined;
      const jsonSchema = zodSchema ? await zodToJsonSchema(zodSchema) : asJsonSchemaObject(schema);
      assertSupportedSchema(jsonSchema);

      const req = normalizeRequest(genOpts);
      const { result, grammar } = await runRequest({
        req,
        requestId,
        signal: genOpts.signal,
        jsonSchema,
        ...(schemaName !== undefined ? { schemaName } : {}),
      });
      if (result.finishReason === "abort") throw abortedError();
      if (!grammar) throw schemaViolation("no grammar was built");

      const value = parseStructured(grammar, result.text, zodSchema);
      emitEvent(onEvent, { type: "request:done", id: requestId, result: withoutText(result) });
      const { text: raw, ...rest } = result;
      return { ...rest, object: value, raw };
    } catch (err) {
      emitEvent(onEvent, { type: "request:error", id: requestId, error: toInboardError(err) });
      throw err;
    }
  }

  function stream(opts: GenerateOptions): StreamResult {
    const requestId = nextId();
    const controller = new AbortController();
    const forward = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    else opts.signal?.addEventListener("abort", forward, { once: true });

    const chunks = new AsyncChannel<string>();
    const result = (async () =>
      runRequest({
        req: normalizeRequest(opts),
        requestId,
        signal: controller.signal,
        onDelta: (text) => chunks.push(text),
      }))().then(
      ({ result }) => {
        chunks.close();
        if (result.finishReason !== "abort") {
          emitEvent(onEvent, { type: "request:done", id: requestId, result: withoutText(result) });
        }
        return result;
      },
      (err: unknown) => {
        if (isInboardError(err) && err.code === "ABORTED" && controller.signal.aborted) {
          // Aborted while queued: nothing was generated. Resolve, as the contract says.
          chunks.close();
          return emptyAbortResult();
        }
        chunks.fail(err);
        emitEvent(onEvent, { type: "request:error", id: requestId, error: toInboardError(err) });
        throw err;
      },
    );
    result.finally(() => opts.signal?.removeEventListener("abort", forward)).catch(() => undefined);
    // Callers may only read `textStream`. Keep an unobserved rejection from becoming an unhandled one.
    result.catch(() => undefined);

    return {
      textStream: chunks,
      result,
      abort: () => controller.abort(),
    };
  }

  function emptyAbortResult(): GenerateResult {
    return {
      text: "",
      finishReason: "abort",
      model: loaded?.info.id ?? id,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      timing: { queueMs: 0, loadMs: 0, firstTokenMs: 0, totalMs: 0, tokensPerSecond: 0 },
    };
  }

  function nextId(): string {
    requestCounter += 1;
    return `req-${requestCounter}`;
  }

  return {
    async ready(): Promise<ModelInfo> {
      const { state } = await ensureLoaded();
      return state.info;
    },
    generate,
    stream,
    object: object as Inboard["object"],
    async countTokens(text: string): Promise<number> {
      const { state } = await ensureLoaded();
      return state.backend.countTokens(text);
    },
    info(): ModelInfo | null {
      return loaded?.info ?? null;
    },
    async unload(): Promise<void> {
      if (loading) await loading.catch(() => undefined);
      const current = loaded;
      if (!current) return;
      loaded = undefined;
      unloading = (async () => {
        await current.scheduler.drain();
        await current.backend.unload();
      })();
      try {
        await unloading;
      } finally {
        unloading = undefined;
      }
    },
  };
}

function validateOptions(options: InboardOptions): void {
  if (!options || typeof options !== "object") {
    throw new InboardError("INVALID_OPTIONS", "createInboard needs an options object", {
      hint: 'Pass { model: "qwen2.5-0.5b" } at least.',
    });
  }
  const { model } = options;
  if (typeof model === "string") {
    if (!(MODEL_IDS as readonly string[]).includes(model)) {
      throw new InboardError("INVALID_OPTIONS", `Unknown model "${model}"`, {
        hint: `Choose one of: ${MODEL_IDS.join(", ")}, or pass { path } for a custom GGUF.`,
      });
    }
  } else if (!model || typeof model.path !== "string" || model.path.length === 0) {
    throw new InboardError("INVALID_OPTIONS", "model must be a registry id or { path }", {
      hint: 'Example: createInboard({ model: { path: "./models/custom.gguf" } })',
    });
  }
  if (
    options.maxConcurrency !== undefined &&
    (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1)
  ) {
    throw new InboardError("INVALID_OPTIONS", "maxConcurrency must be an integer >= 1", {
      hint: "Set maxConcurrency to 1 or more.",
    });
  }
  if (
    options.maxQueue !== undefined &&
    (!Number.isInteger(options.maxQueue) || options.maxQueue < 0)
  ) {
    throw new InboardError("INVALID_OPTIONS", "maxQueue must be an integer >= 0", {
      hint: "Set maxQueue to 0 or more.",
    });
  }
}

async function assertExists(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (err) {
    throw new InboardError("MODEL_NOT_FOUND", `No file at ${path}`, {
      hint: "Check the path. Custom models must be GGUF files on disk.",
      cause: err,
    });
  }
}

/** Parses generated text with the grammar's validator, then with the Zod schema when one was given. */
function parseStructured(
  grammar: JsonGrammar,
  text: string,
  zodSchema: ZodLikeSchema | undefined,
): unknown {
  let value: unknown;
  try {
    value = grammar.parse(text);
  } catch (err) {
    throw schemaViolation(err instanceof Error ? err.message : "invalid JSON", err);
  }
  if (!zodSchema) return value;

  const parser = zodSchema as unknown as {
    safeParse(
      input: unknown,
    ): { success: true; data: unknown } | { success: false; error: { message: string } };
  };
  const checked = parser.safeParse(value);
  if (!checked.success) throw schemaViolation(checked.error.message);
  return checked.data;
}

/** Checks that a plain schema argument is a JSON Schema object before it reaches the grammar. */
function asJsonSchemaObject(schema: unknown): JsonSchemaObject {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new InboardError(
      "INVALID_OPTIONS",
      "schema must be a Zod schema or a JSON Schema object",
      {
        hint: 'Example: { type: "object", properties: { label: { type: "string" } } }',
      },
    );
  }
  return schema as JsonSchemaObject;
}

function withoutText(result: GenerateResult): Omit<GenerateResult, "text"> {
  const { text: _text, ...rest } = result;
  return rest;
}

function toInboardError(err: unknown): InboardError {
  if (isInboardError(err)) return err;
  return new InboardError(
    "BACKEND_CRASHED",
    err instanceof Error ? err.message : "Unknown backend error",
    {
      hint: "Run: npx inboard doctor. If this persists, report it with the stack trace.",
      cause: err,
    },
  );
}
