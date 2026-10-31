// biome-ignore-all lint/style/useErrorCause: GgmlNodeError takes its cause inside the options object (see src/core/errors.ts)
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { type ModelMeta, readModelMeta } from "@/backend/gguf-meta.js";
import { createIsolatedBackend } from "@/backend/host.js";
import { createLlamaCppBackend } from "@/backend/llama-cpp.js";
import { AsyncChannel } from "@/core/channel.js";
import { GgmlNodeError, isGgmlNodeError } from "@/core/errors.js";
import { emitEvent } from "@/core/events.js";
import {
  estimateModelBytes,
  type MemoryReaders,
  nodeMemoryReaders,
  preflight,
} from "@/core/memory.js";
import { fitToBudget, type NormalizedRequest, normalizeRequest } from "@/core/prompt.js";
import { abortedError, Scheduler } from "@/core/scheduler.js";
import { embedOptionsSchema, firstIssue, ggmlNodeOptionsSchema } from "@/core/schemas.js";
import {
  assertSupportedSchema,
  isZodLike,
  schemaViolation,
  withSchemaInstruction,
  zodToJsonSchema,
} from "@/core/structured.js";
import type {
  EmbedOptions,
  EmbedResult,
  GenerateOptions,
  GenerateResult,
  GgmlNode,
  GgmlNodeOptions,
  JsonSchemaObject,
  ModelInfo,
  ModelKind,
  ObjectOptions,
  ObjectResult,
  StreamResult,
  ZodLikeSchema,
} from "@/core/types.js";
import { env as defaultEnv, type GgmlNodeEnv } from "@/env.js";
import { resolveCacheDir, resolveOffline } from "@/registry/cache.js";
import { ensureModel } from "@/registry/ensure.js";
import { MODELS, type ModelId } from "@/registry/models.js";
import type {
  Backend,
  BackendEmbedResult,
  BackendRequest,
  BackendResult,
  ParsedOutput,
} from "@/types.js";

const DEFAULT_CONTEXT_CAP = 4096;

/** Injection points. Production uses the defaults. Tests pass a fake backend and fixed metadata. */
export interface GgmlNodeDeps {
  createBackend: () => Backend;
  /** Backend for `isolation: "process"`: the native backend in a child process. */
  createIsolatedBackend: () => Backend;
  /** The environment for offline and cache dir resolution. Defaults to the validated `env`. */
  env: GgmlNodeEnv;
  memory: MemoryReaders;
  /** Whether a custom model path exists. Injected so tests and `ggml-node/testing` need no file. */
  pathExists: (path: string) => Promise<boolean>;
  readMeta: (path: string) => Promise<ModelMeta>;
}

export const defaultDeps: GgmlNodeDeps = {
  createBackend: createLlamaCppBackend,
  createIsolatedBackend: () => createIsolatedBackend(),
  env: defaultEnv,
  memory: nodeMemoryReaders,
  pathExists: async (path) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  readMeta: readModelMeta,
};

interface Loaded {
  backend: Backend;
  info: ModelInfo;
  scheduler: Scheduler;
}

interface RunSpec {
  /** When set, generation is constrained to this schema and the output is parsed against it. */
  jsonSchema?: JsonSchemaObject | undefined;
  onDelta?: ((text: string) => void) | undefined;
  req: NormalizedRequest;
  requestId: string;
  schemaName?: string | undefined;
  signal?: AbortSignal | undefined;
}

interface RunOutcome {
  /** Structured output as checked by the backend. Set only when the request used a grammar. */
  parsed: ParsedOutput | undefined;
  result: GenerateResult;
}

/** Creates an in-process inference handle. Models load lazily on first use, or on `ready()`. */
export function createGgmlNode(options: GgmlNodeOptions): GgmlNode {
  return createGgmlNodeWithDeps(options, defaultDeps);
}

export function createGgmlNodeWithDeps(
  options: GgmlNodeOptions,
  overrides: Partial<GgmlNodeDeps> = {},
): GgmlNode {
  const deps: GgmlNodeDeps = { ...defaultDeps, ...overrides };
  validateOptions(options);

  const id: ModelId | "custom" = typeof options.model === "string" ? options.model : "custom";
  const isolation = options.isolation ?? "none";
  const offline = resolveOffline(options.offline, deps.env);
  const cacheDir = resolveCacheDir({ cacheDir: options.cacheDir, env: deps.env });
  const maxConcurrency = options.maxConcurrency ?? 1;
  const maxQueue = options.maxQueue ?? 64;
  const threads =
    options.threads === "auto" || options.threads === undefined ? undefined : options.threads;
  const gpu = options.gpu ?? "auto";
  const autoDownload = options.autoDownload ?? true;
  const acceptLicense = options.acceptLicense ?? false;
  const { onEvent } = options;

  let loaded: Loaded | undefined;
  let loading: Promise<Loaded> | undefined;
  let unloading: Promise<void> | undefined;
  let requestCounter = 0;

  async function loadModel(): Promise<Loaded> {
    const backend = isolation === "process" ? deps.createIsolatedBackend() : deps.createBackend();
    const modelLabel: ModelId | "custom" = id;
    emitEvent(onEvent, { model: modelLabel, type: "load:start" });
    const started = performance.now();

    let path: string;
    let license: string;
    let contextCap: number;
    if (typeof options.model === "string") {
      const entry = MODELS[options.model];
      ({ license } = entry);
      contextCap = entry.contextLength;
      path = await ensureModel(options.model, {
        acceptLicense,
        allowDownload: !offline && autoDownload,
        cacheDir,
        offline,
        onEvent: (e) => emitEvent(onEvent, e),
      });
    } else {
      path = resolve(options.model.path);
      license = "unknown";
      contextCap = Number.POSITIVE_INFINITY;
      if (!(await deps.pathExists(path))) {
        throw new GgmlNodeError("MODEL_NOT_FOUND", `No file at ${path}`, {
          hint: "Check the path. Custom models must be GGUF files on disk.",
        });
      }
    }

    const meta = await deps.readMeta(path);
    const kind: ModelKind = options.kind ?? meta.kind;
    const contextSize =
      options.contextSize ??
      Math.min(Math.min(contextCap, meta.trainContextSize), DEFAULT_CONTEXT_CAP);
    if (!Number.isInteger(contextSize) || contextSize < 1) {
      throw new GgmlNodeError("INVALID_OPTIONS", "contextSize must be a positive integer", {
        hint: "Set contextSize to a whole number, or leave it unset.",
      });
    }

    // An embedding context evaluates one input at a time, so it needs the KV cache of one sequence.
    const sequences = kind === "embedding" ? 1 : maxConcurrency;
    await preflight({
      contextSize,
      estimateBytes: estimateModelBytes(meta.sizeBytes, meta.shape, contextSize, sequences),
      readers: deps.memory,
      sequences,
    });

    try {
      const backendInfo = await backend.load({
        contextSize,
        gpu,
        kind,
        path,
        sequences,
        ...(threads === undefined ? {} : { threads }),
      });
      const info: ModelInfo = {
        backend: "llama-cpp",
        contextSize: backendInfo.contextSize,
        ...(backendInfo.dimensions === undefined ? {} : { dimensions: backendInfo.dimensions }),
        gpu: backendInfo.gpu,
        id: modelLabel,
        kind,
        license,
        path,
        sizeBytes: backendInfo.sizeBytes,
      };
      const ms = performance.now() - started;
      emitEvent(onEvent, { model: modelLabel, ms, type: "load:done" });
      return { backend, info, scheduler: new Scheduler({ maxQueue, sequences: maxConcurrency }) };
    } catch (err) {
      await backend.unload().catch(() => undefined);
      throw toGgmlNodeError(err);
    }
  }

  /** Loads the model once. Concurrent callers share the same load. Returns `loadMs: 0` when already loaded. */
  async function ensureLoaded(): Promise<{ state: Loaded; loadMs: number }> {
    if (unloading) {
      await unloading;
    }
    if (loaded) {
      return { loadMs: 0, state: loaded };
    }
    const started = performance.now();
    loading ??= loadModel().then(
      (loadedState) => {
        loaded = loadedState;
        loading = undefined;
        return loadedState;
      },
      (err: unknown) => {
        loading = undefined;
        throw err;
      },
    );
    const state = await loading;
    return { loadMs: performance.now() - started, state };
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one request lifecycle (validate, queue, generate, account), kept in one place on purpose
  async function runRequest(spec: RunSpec): Promise<RunOutcome> {
    const { req, requestId, signal, onDelta, jsonSchema, schemaName } = spec;
    const started = performance.now();
    const { state, loadMs } = await ensureLoaded();
    const { backend, scheduler, info } = state;
    requireKind(info, "generation");
    const budget = info.contextSize - req.maxTokens;
    if (budget <= 0) {
      throw new GgmlNodeError(
        "INVALID_OPTIONS",
        `maxTokens (${req.maxTokens}) must be less than contextSize (${info.contextSize})`,
        { hint: "Lower maxTokens or raise contextSize." },
      );
    }

    const grammar = jsonSchema ? await backend.buildJsonGrammar(jsonSchema) : undefined;
    const withInstruction =
      jsonSchema === undefined
        ? req.messages
        : withSchemaInstruction(req.messages, jsonSchema, schemaName);
    const messages = await fitToBudget(withInstruction, budget, req.overflow, (m) =>
      backend.countPromptTokens(m),
    );

    const lease = await scheduler.acquire(signal, (queueLength) =>
      emitEvent(onEvent, { id: requestId, queueLength, type: "request:queued" }),
    );

    emitEvent(onEvent, { id: requestId, type: "request:start" });
    let outcome: BackendResult;
    try {
      await backend.resetSequence(lease.index);
      const request: BackendRequest = {
        maxTokens: req.maxTokens,
        messages,
        temperature: req.temperature,
        ...(req.topP === undefined ? {} : { topP: req.topP }),
        ...(req.topK === undefined ? {} : { topK: req.topK }),
        ...(req.seed === undefined ? {} : { seed: req.seed }),
        ...(req.stop === undefined ? {} : { stop: req.stop }),
        ...(signal ? { signal } : {}),
        ...(grammar ? { grammar } : {}),
      };
      outcome = await backend.generate(lease.index, request, (text) => onDelta?.(text));
    } catch (err) {
      throw toGgmlNodeError(err);
    } finally {
      lease.release();
    }

    const totalMs = performance.now() - started;
    const genMs = Math.max(totalMs - lease.queueMs, 1);
    const result: GenerateResult = {
      finishReason: outcome.finishReason,
      model: info.id,
      text: outcome.text,
      timing: {
        firstTokenMs: outcome.firstTokenMs,
        loadMs,
        queueMs: lease.queueMs,
        tokensPerSecond: outcome.usage.outputTokens / (genMs / 1000),
        totalMs: totalMs + loadMs,
      },
      usage: outcome.usage,
    };
    return { parsed: outcome.parsed, result };
  }

  async function generate(opts: GenerateOptions): Promise<GenerateResult> {
    const requestId = nextId();
    try {
      const req = normalizeRequest(opts);
      const { result } = await runRequest({ req, requestId, signal: opts.signal });
      if (result.finishReason === "abort") {
        throw abortedError();
      }
      emitEvent(onEvent, { id: requestId, result: withoutText(result), type: "request:done" });
      return result;
    } catch (err) {
      emitEvent(onEvent, { error: toGgmlNodeError(err), id: requestId, type: "request:error" });
      throw err;
    }
  }

  async function embed(opts: EmbedOptions): Promise<EmbedResult> {
    const requestId = nextId();
    try {
      const inputs = embedInputs(opts.input);
      const started = performance.now();
      const { state, loadMs } = await ensureLoaded();
      const { backend, scheduler, info } = state;
      requireKind(info, "embedding");
      if (info.dimensions === undefined) {
        throw new GgmlNodeError("BACKEND_CRASHED", "The embedding model did not report its size", {
          hint: "Run: npx ggml-node doctor. If this persists, report it with the stack trace.",
        });
      }

      const lease = await scheduler.acquire(opts.signal, (queueLength) =>
        emitEvent(onEvent, { id: requestId, queueLength, type: "request:queued" }),
      );
      emitEvent(onEvent, { id: requestId, type: "request:start" });
      let outcome: BackendEmbedResult;
      try {
        outcome = await backend.embed(inputs, opts.signal);
      } catch (err) {
        throw toGgmlNodeError(err);
      } finally {
        lease.release();
      }

      const result: EmbedResult = {
        dimensions: info.dimensions,
        embeddings: outcome.vectors,
        model: info.id,
        timing: { loadMs, queueMs: lease.queueMs, totalMs: performance.now() - started },
        usage: { inputTokens: outcome.inputTokens, totalTokens: outcome.inputTokens },
      };
      const { embeddings: _embeddings, ...summary } = result;
      emitEvent(onEvent, { id: requestId, result: summary, type: "embed:done" });
      return result;
    } catch (err) {
      emitEvent(onEvent, { error: toGgmlNodeError(err), id: requestId, type: "request:error" });
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
      const { result, parsed } = await runRequest({
        jsonSchema,
        req,
        requestId,
        signal: genOpts.signal,
        ...(schemaName === undefined ? {} : { schemaName }),
      });
      if (result.finishReason === "abort") {
        throw abortedError();
      }

      const value = checkStructured(parsed, zodSchema);
      emitEvent(onEvent, { id: requestId, result: withoutText(result), type: "request:done" });
      const { text: raw, ...rest } = result;
      return { ...rest, object: value, raw };
    } catch (err) {
      emitEvent(onEvent, { error: toGgmlNodeError(err), id: requestId, type: "request:error" });
      throw err;
    }
  }

  function stream(opts: GenerateOptions): StreamResult {
    const requestId = nextId();
    const controller = new AbortController();
    const forward = () => controller.abort();
    if (opts.signal?.aborted) {
      controller.abort();
    } else {
      opts.signal?.addEventListener("abort", forward, { once: true });
    }

    const chunks = new AsyncChannel<string>();
    const result = (async () =>
      runRequest({
        onDelta: (text) => chunks.push(text),
        req: normalizeRequest(opts),
        requestId,
        signal: controller.signal,
      }))().then(
      (outcome) => {
        const { result: finished } = outcome;
        chunks.close();
        if (finished.finishReason !== "abort") {
          emitEvent(onEvent, {
            id: requestId,
            result: withoutText(finished),
            type: "request:done",
          });
        }
        return finished;
      },
      (err: unknown) => {
        if (isGgmlNodeError(err) && err.code === "ABORTED" && controller.signal.aborted) {
          // Aborted while queued: nothing was generated. Resolve, as the contract says.
          chunks.close();
          return emptyAbortResult();
        }
        chunks.fail(err);
        emitEvent(onEvent, { error: toGgmlNodeError(err), id: requestId, type: "request:error" });
        throw err;
      },
    );
    result.finally(() => opts.signal?.removeEventListener("abort", forward)).catch(() => undefined);
    // Callers may only read `textStream`. Keep an unobserved rejection from becoming an unhandled one.
    result.catch(() => undefined);

    return {
      abort: () => controller.abort(),
      result,
      textStream: chunks,
    };
  }

  function emptyAbortResult(): GenerateResult {
    return {
      finishReason: "abort",
      model: loaded?.info.id ?? id,
      text: "",
      timing: { firstTokenMs: 0, loadMs: 0, queueMs: 0, tokensPerSecond: 0, totalMs: 0 },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  function nextId(): string {
    requestCounter += 1;
    return `req-${requestCounter}`;
  }

  return {
    async countTokens(text: string): Promise<number> {
      const { state } = await ensureLoaded();
      return state.backend.countTokens(text);
    },
    embed,
    generate,
    info(): ModelInfo | null {
      return loaded?.info ?? null;
    },
    object: object as GgmlNode["object"],
    async ready(): Promise<ModelInfo> {
      const { state } = await ensureLoaded();
      return state.info;
    },
    stream,
    async unload(): Promise<void> {
      if (loading) {
        await loading.catch(() => undefined);
      }
      const current = loaded;
      if (!current) {
        return;
      }
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

function validateOptions(options: GgmlNodeOptions): void {
  const parsed = ggmlNodeOptionsSchema.safeParse(options);
  if (parsed.success) {
    return;
  }
  const issue = firstIssue(parsed.error);
  throw new GgmlNodeError("INVALID_OPTIONS", `${issue.path}: ${issue.message}`, {
    hint: "Check createGgmlNode options against docs/API.md.",
  });
}

/** Parses generated text with the grammar's validator, then with the Zod schema when one was given. */
function checkStructured(
  parsed: ParsedOutput | undefined,
  zodSchema: ZodLikeSchema | undefined,
): unknown {
  if (!parsed) {
    throw schemaViolation("the backend returned no structured output");
  }
  if (!parsed.ok) {
    throw schemaViolation(parsed.message);
  }
  const { value } = parsed;
  if (!zodSchema) {
    return value;
  }

  const parser = zodSchema as unknown as {
    safeParse: (
      input: unknown,
    ) => { success: true; data: unknown } | { success: false; error: { message: string } };
  };
  const checked = parser.safeParse(value);
  if (!checked.success) {
    throw schemaViolation(checked.error.message);
  }
  return checked.data;
}

/** Checks the embed input and returns it as a batch. A single string is a batch of one. */
function embedInputs(input: EmbedOptions["input"]): string[] {
  const parsed = embedOptionsSchema.safeParse({ input });
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    throw new GgmlNodeError("INVALID_OPTIONS", `${issue.path}: ${issue.message}`, {
      hint: "Pass a non-empty string, or a non-empty array of non-empty strings.",
    });
  }
  return typeof parsed.data.input === "string" ? [parsed.data.input] : parsed.data.input;
}

/** A generation call on an embedding model, or the reverse, fails before any work runs. */
function requireKind(info: ModelInfo, needed: ModelKind): void {
  if (info.kind === needed) {
    return;
  }
  const describe = (kind: ModelKind) => (kind === "embedding" ? "an embedding" : "a generation");
  const isEmbed = needed === "embedding";
  throw new GgmlNodeError(
    "INVALID_OPTIONS",
    `This call needs ${describe(needed)} model, but the model is ${describe(info.kind)} model`,
    {
      hint: isEmbed
        ? "Use generate() for a generation model. Load an embedding model with its GGUF path."
        : "Use embed() for an embedding model, or load a generation model.",
    },
  );
}

/** Checks that a plain schema argument is a JSON Schema object before it reaches the grammar. */
function asJsonSchemaObject(schema: unknown): JsonSchemaObject {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new GgmlNodeError(
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

function toGgmlNodeError(err: unknown): GgmlNodeError {
  if (isGgmlNodeError(err)) {
    return err;
  }
  return new GgmlNodeError(
    "BACKEND_CRASHED",
    err instanceof Error ? err.message : "Unknown backend error",
    {
      cause: err,
      hint: "Run: npx ggml-node doctor. If this persists, report it with the stack trace.",
    },
  );
}
