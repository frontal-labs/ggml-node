# PLAN.md: Build "Inboard"

> An LLM inside your Node process. No daemon, no API key, no port.

You are building **Inboard**, a TypeScript library that runs a small quantized LLM **in-process** in Node.js (no Ollama, no external server), exposes a strongly typed API, and ships an **AI SDK provider** so it works with `generateText`, `streamText`, and `generateObject`.

Work milestone by milestone. Do not start a milestone until the previous one meets its acceptance criteria. After each milestone, run `pnpm verify` (lint + typecheck + test + build) and fix everything before moving on.

---

## 0. Ground rules for the agent

- **Verify, don't assume, third-party APIs.** Before writing code against `node-llama-cpp`, `ai`, `@ai-sdk/provider`, or `zod`, install them and read their type definitions in `node_modules` and their docs. The snippets in this plan are illustrative and may be out of date. The installed types are the source of truth.
- **Never invent model URLs or checksums.** Every model registry entry must point to a real file. Compute SHA-256 by downloading the file (see Milestone 2). If you can't verify a model, leave it out.
- **No network in unit tests.** Only the `e2e` test suite may download models, and it must be opt-in (`INBOARD_E2E=1`).
- **No postinstall scripts.** Installing the package must never download anything.
- **No telemetry.** Nothing phones home. Event hooks are local only.
- Keep the public API exactly as specified in Section 3. If you believe a change is needed, write it in `DECISIONS.md` with a rationale instead of silently changing it.
- Prefer small, reviewable commits, one logical change per commit, with conventional commit messages.

---

## 1. Decisions (defaults, owner may override)

| Decision | Default |
|---|---|
| Package name | `inboard` (check `npm view inboard`; if taken, use `@inboard/core` and adjust subpaths) |
| License | MIT |
| Runtime | Node.js >= 20, ESM only |
| Inference backend (v1) | `node-llama-cpp` (latest stable major) |
| AI SDK target | The current stable major of `ai`; implement whichever `LanguageModelV*` spec version its matching `@ai-sdk/provider` exports |
| Browser/edge backend | Out of scope for v1. Define the backend interface so it can be added later |
| Default model | `qwen2.5-0.5b` (Qwen2.5-0.5B-Instruct, GGUF Q4_K_M, Apache 2.0) |
| Tool calling | Out of scope for v1 (tiny models are unreliable at it) |
| Package manager / tools | pnpm, TypeScript strict, tsup (build), vitest (test), biome (lint/format) |

---

## 2. Repository layout

```
inboard/
  package.json            # single published package with subpath exports
  tsconfig.json
  tsup.config.ts
  biome.json
  PLAN.md  DECISIONS.md  README.md  CHANGELOG.md  LICENSE
  src/
    index.ts              # public core API: createInboard, types, errors
    ai/index.ts           # "inboard/ai": AI SDK provider
    testing/index.ts      # "inboard/testing": mock model
    cli/index.ts          # "inboard" bin
    core/
      inboard.ts          # createInboard implementation
      scheduler.ts        # sequence pool + FIFO queue + abort
      prompt.ts           # message normalization, token counting, overflow policies
      structured.ts       # zod/JSON Schema -> grammar, parse + validate
      errors.ts           # InboardError + codes
      events.ts           # typed event emitter
      memory.ts           # RAM estimation + preflight
    registry/
      models.ts           # typed manifest (as const)
      cache.ts            # cache dir resolution
      download.ts         # resumable download + SHA-256 verify + progress
    backend/
      types.ts            # Backend interface
      llama-cpp.ts        # node-llama-cpp implementation
      isolated/           # child-process isolation (host.ts + worker.ts + protocol.ts)
  test/
    unit/                 # no network, no real model
    e2e/                  # INBOARD_E2E=1, real model
  examples/
    basic/  ai-sdk/  structured/  express-server/  docker/  electron/
  docs/
    getting-started.md  api.md  ai-sdk.md  structured-output.md
    deployment.md  testing.md  troubleshooting.md  what-tiny-models-are-good-at.md
```

`package.json` exports:

```json
{
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./ai": { "types": "./dist/ai/index.d.ts", "import": "./dist/ai/index.js" },
    "./testing": { "types": "./dist/testing/index.d.ts", "import": "./dist/testing/index.js" }
  },
  "bin": { "inboard": "./dist/cli/index.js" },
  "peerDependencies": { "ai": "*", "zod": "*" },
  "peerDependenciesMeta": { "ai": { "optional": true }, "zod": { "optional": true } },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "test": "vitest run test/unit",
    "test:e2e": "INBOARD_E2E=1 vitest run test/e2e",
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  }
}
```

Pin real version ranges for peers once installed (do not leave `*`).

---

## 3. Public API (contract)

### 3.1 Core

```ts
import { createInboard } from "inboard";

const ai = createInboard({
  model: "qwen2.5-0.5b",         // ModelId (typed union from registry) OR { path: string } for a custom GGUF
  contextSize: 2048,             // default: min(model.contextLength, 4096)
  maxConcurrency: 1,             // parallel sequences
  maxQueue: 64,                  // pending requests beyond concurrency; overflow -> QUEUE_FULL
  threads: "auto",               // number | "auto"
  gpu: "auto",                   // "auto" | false  (Metal/CUDA/Vulkan if available)
  isolation: "none",             // "none" | "process"
  cacheDir: undefined,           // default: env INBOARD_CACHE_DIR or OS cache dir /inboard
  offline: false,                // or env INBOARD_OFFLINE=1
  autoDownload: true,            // if model missing and not offline, download lazily
  acceptLicense: false,          // required for models whose license != Apache-2.0/MIT
  onEvent: (e) => {},            // typed InboardEvent
});

await ai.ready();                // optional warm-up; idempotent; returns ModelInfo
await ai.generate(opts);         // -> GenerateResult
ai.stream(opts);                 // -> StreamResult
await ai.object({ schema, ...}); // -> ObjectResult<T>
await ai.countTokens(text);      // -> number
ai.info();                       // -> ModelInfo | null (null before load)
await ai.unload();               // frees memory; next call reloads
```

### 3.2 Types

```ts
export type ModelId = keyof typeof MODELS; // e.g. "qwen2.5-0.5b" | "qwen2.5-1.5b" | "smollm2-360m"

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface GenerateOptions {
  prompt?: string; // exactly one of prompt | messages
  messages?: Message[];
  system?: string;
  maxTokens?: number; // default 256
  temperature?: number; // default 0.7
  topP?: number;
  topK?: number;
  seed?: number; // deterministic sampling when set
  stop?: string[];
  overflow?: "error" | "truncate-start" | "truncate-middle"; // default "error"
  signal?: AbortSignal;
}

export type FinishReason = "stop" | "length" | "abort";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export interface Timing {
  queueMs: number;
  loadMs: number;
  firstTokenMs: number;
  totalMs: number;
  tokensPerSecond: number;
}

export interface GenerateResult {
  text: string;
  finishReason: FinishReason;
  model: ModelId | "custom";
  usage: Usage;
  timing: Timing;
}

export interface StreamResult {
  textStream: AsyncIterable<string>; // text deltas
  result: Promise<GenerateResult>; // resolves at end, same shape as generate()
  abort(): void;
}

export interface ObjectOptions<S> extends Omit<GenerateOptions, "stop"> {
  schema: S;
  schemaName?: string;
}
export interface ObjectResult<T> extends Omit<GenerateResult, "text"> {
  object: T;
  raw: string;
}
// object() overloads: Zod schema -> z.infer<S>; JSON Schema object -> unknown (or generic T)

export interface ModelInfo {
  id: ModelId | "custom";
  path: string;
  sizeBytes: number;
  contextSize: number;
  license: string;
  backend: "llama-cpp";
  gpu: string | false;
}

export type InboardEvent =
  | { type: "download:start"; model: ModelId; totalBytes: number }
  | { type: "download:progress"; model: ModelId; receivedBytes: number; totalBytes: number }
  | { type: "download:done"; model: ModelId; path: string }
  | { type: "load:start"; model: ModelId | "custom" }
  | { type: "load:done"; model: ModelId | "custom"; ms: number }
  | { type: "request:queued"; id: string; queueLength: number }
  | { type: "request:start"; id: string }
  | { type: "request:done"; id: string; result: Omit<GenerateResult, "text"> }
  | { type: "request:error"; id: string; error: InboardError };
```

### 3.3 Errors

```ts
export type InboardErrorCode =
  | "MODEL_NOT_FOUND" // not in cache and offline/autoDownload=false
  | "DOWNLOAD_FAILED"
  | "CHECKSUM_MISMATCH"
  | "LICENSE_NOT_ACCEPTED"
  | "UNSUPPORTED_PLATFORM"
  | "OUT_OF_MEMORY" // preflight estimate exceeds available memory, or backend OOM
  | "CONTEXT_OVERFLOW"
  | "QUEUE_FULL"
  | "ABORTED"
  | "SCHEMA_VIOLATION" // decoded output failed validation (should be rare with grammar)
  | "INVALID_OPTIONS"
  | "BACKEND_CRASHED"; // isolation: "process" child died

export class InboardError extends Error {
  readonly code: InboardErrorCode;
  readonly hint: string; // actionable, e.g. "Run: npx inboard pull qwen2.5-0.5b"
  readonly cause?: unknown;
}
export function isInboardError(e: unknown): e is InboardError;
```

Every thrown error from the public API must be an `InboardError`. Every error must have a non-empty, actionable `hint`.

### 3.4 AI SDK provider (`inboard/ai`)

```ts
import { generateText, streamText, generateObject } from "ai";
import { inboard, createInboardProvider } from "inboard/ai";

generateText({ model: inboard("qwen2.5-0.5b"), prompt: "..." });

const local = createInboardProvider({ maxConcurrency: 2, cacheDir: "./models" });
streamText({ model: local("qwen2.5-0.5b"), messages });
```

- `inboard(modelId, settings?)` uses a shared default provider. Same modelId + settings returns the same loaded instance (one model load per process).
- Implement `doGenerate` and `doStream` per the installed `@ai-sdk/provider` spec.
- Map: `prompt` messages (system/user/assistant text parts) to core `messages`; `maxOutputTokens`, `temperature`, `topP`, `topK`, `seed`, `stopSequences`, `abortSignal` to core options.
- `responseFormat: { type: "json", schema }` must use grammar-constrained generation (same path as `ai.object()`).
- Unsupported inputs (images, files, tool calls, tool definitions) produce a provider **warning** (not a crash) and are ignored. A tool-required `toolChoice` throws `INVALID_OPTIONS`.
- Return real `usage` token counts and map finish reasons correctly.

### 3.5 Testing (`inboard/testing`)

```ts
import { createMockInboard, mockModel } from "inboard/testing";

const ai = createMockInboard({
  respond: (req) => `echo: ${req.messages.at(-1)?.content}`, // or a string[] played in order
  delayMs: 0,
  tokensPerChunk: 1,
});
// same interface as createInboard; object() returns respond() output parsed as JSON

generateText({ model: mockModel({ respond: "hi" }), prompt: "x" }); // AI SDK mock
```

No native module is loaded when only `inboard/testing` is imported. Verify this with a test.

### 3.6 CLI

```
npx inboard pull <modelId> [--dir <path>]    # download + verify checksum
npx inboard list                             # registry models, cached status, size, license
npx inboard doctor                           # platform, arch, CPU features, RAM, GPU, cache dir, backend load test
npx inboard bench [modelId] [--tokens 128]   # load time, first token ms, tokens/sec, peak RSS
npx inboard run "<prompt>" [--model <id>] [--json-schema <file>]
npx inboard cache path | cache clear [<modelId>]
```

Exit codes: 0 success, 1 user error, 2 environment error. `--json` flag on `list`, `doctor` and `bench` for machine-readable output.

---

## 4. Milestones

### M1: Scaffolding

- pnpm project, strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), tsup ESM build with d.ts, vitest, biome, GitHub Actions CI (ubuntu, macos, windows on Node 20 and 22) running `pnpm verify`.
- Stub all public exports with the exact types from Section 3 (they may throw "not implemented").

**Accept when:** `pnpm verify` passes on all CI OSes; `tsd`-style type tests (vitest `expectTypeOf`) assert the public signatures from Section 3.

### M2: Model registry and download

- `registry/models.ts`: `as const` manifest. Fields: `id`, `displayName`, `hfRepo`, `file`, `url`, `sha256`, `sizeBytes`, `contextLength`, `license`, `licenseUrl`, `ramEstimateBytes`, `notes`.
- Initial entries (verify each exists; drop any you can't verify): `qwen2.5-0.5b` (default), `qwen2.5-1.5b`, `smollm2-360m`. Optionally `llama3.2-1b` flagged as requiring `acceptLicense`.
- Write `scripts/compute-checksums.ts` that downloads each entry and writes the real `sha256` and `sizeBytes`. Run it and commit the results.
- `download.ts`: streaming download to `*.partial`, HTTP range resume, SHA-256 while streaming, atomic rename, progress events, one download per model even under concurrent callers (lock file + in-process promise dedupe).
- `cache.ts`: resolve `cacheDir` from option > `INBOARD_CACHE_DIR` > OS cache dir (`~/Library/Caches/inboard`, `$XDG_CACHE_HOME/inboard` or `~/.cache/inboard`, `%LOCALAPPDATA%\inboard\cache`).
- CLI: `pull`, `list`, `cache`.

**Accept when:** unit tests cover checksum mismatch, resume, concurrent dedupe, offline mode (all with a local HTTP fixture server, no internet); `npx inboard pull qwen2.5-0.5b` works manually.

### M3: Backend and core generate/stream

- `backend/types.ts`:

  ```ts
  interface Backend {
    load(o: { path: string; contextSize: number; sequences: number; threads?: number; gpu: "auto" | false }): Promise<ModelInfo>;
    tokenize(text: string): Promise<number[]>;
    applyChatTemplate(messages: Message[]): Promise<{ tokens: number }>; // or equivalent
    generate(seq: number, req: BackendRequest, onDelta: (t: string) => void): Promise<BackendResult>;
    unload(): Promise<void>;
  }
  ```
- `llama-cpp.ts`: implement with node-llama-cpp. Use its chat-template support from GGUF metadata (never hand-write templates). Create a fresh, stateless chat per request on a pooled sequence.
- `scheduler.ts`: pool of `maxConcurrency` sequences, FIFO queue bounded by `maxQueue`, `QUEUE_FULL` on overflow, abort while queued (remove from queue) or running (stop generation, release sequence, `finishReason: "abort"`; `generate()` rejects with `ABORTED`, `stream().result` resolves with `abort`).
- `prompt.ts`: normalize `prompt | messages | system`; validate exactly one of prompt/messages (`INVALID_OPTIONS`); count tokens; apply overflow policy, always keeping the system message and the last user message.
- `memory.ts`: preflight estimate (`file size + KV cache estimate × sequences`) vs `os.freemem()`/cgroup limit, throwing `OUT_OF_MEMORY` with a hint suggesting a smaller model or lower `contextSize`/`maxConcurrency`.
- Lazy load on first call; `ready()` dedupes concurrent loads; `unload()` waits for in-flight requests.
- Fill `usage` and `timing` precisely.

**Accept when:** unit tests (with a fake Backend) cover the queue, concurrency, abort in both states, overflow policies and error mapping; e2e tests (`INBOARD_E2E=1`) generate and stream with the real default model; the event loop stays responsive during generation (setInterval lag test < 50 ms p95).

### M4: Structured output

- `structured.ts`: accept Zod (convert with Zod's built-in JSON Schema conversion if available in the installed version, else `zod-to-json-schema`) or plain JSON Schema. Build a grammar via node-llama-cpp's JSON-schema grammar support. Generate under the grammar, parse, validate with Zod (or a JSON Schema validator) and throw `SCHEMA_VIOLATION` on failure.
- Document the supported JSON Schema subset (whatever the grammar builder supports); unsupported keywords produce `INVALID_OPTIONS` with a hint at call time, not silent ignoring.
- Inject a short instruction plus the schema into the system prompt to improve content quality (the grammar guarantees the shape, the prompt guides the content).

**Accept when:** e2e: 50 runs of a classification schema and 50 of a nested extraction schema with the default model, all 100 parse and validate; types: `object({ schema: zodSchema })` infers `z.infer`.

### M5: AI SDK provider

- Implement per Section 3.4 against the installed spec version.
- Unit tests using AI SDK's own test utilities if available, otherwise call `doGenerate`/`doStream` directly, plus integration tests with `generateText`, `streamText` and `generateObject` against the mock backend.

**Accept when:** all three AI SDK functions work in `examples/ai-sdk`; warnings appear for unsupported inputs; the stream part sequence matches the spec exactly (verify against the spec types).

### M6: Testing utilities and process isolation

- `inboard/testing` per Section 3.5, with zero native imports (enforce with a test that imports it and asserts `node-llama-cpp` is not in the module cache, or use a bundle analysis check).
- `isolation: "process"`: `child_process.fork` a worker that owns the Backend. Typed IPC protocol (request, delta, done, error, abort). If the child crashes, in-flight requests reject with `BACKEND_CRASHED`; the next request respawns it (max 3 restarts per minute, then stay failed with a clear hint). Clean shutdown on parent exit.

**Accept when:** a test kills the child mid-generation and asserts `BACKEND_CRASHED`, then a successful respawn; same API and types in both isolation modes.

### M7: CLI completion

- `doctor`, `bench`, `run` per Section 3.6. `doctor` must print an actionable fix for each failure.

**Accept when:** each command has a snapshot test (with the fake backend) and works manually with the real model.

### M8: Docs, examples, release

- README: one-paragraph pitch, 30-second quickstart (install, pull, generate), AI SDK snippet, structured output snippet, "when not to use Inboard".
- `docs/` pages listed in Section 2. `deployment.md` must include working recipes:
  - **Docker:** a multi-stage build where the model is pulled in its own layer (`RUN npx inboard pull qwen2.5-0.5b --dir /models`, `ENV INBOARD_CACHE_DIR=/models`, `INBOARD_OFFLINE=1`).
  - **Electron:** `asarUnpack` for the node-llama-cpp binaries and model; resolve the model path from `process.resourcesPath`.
  - **Serverless:** supported only via container images; state that zip-based functions are too small.
- `what-tiny-models-are-good-at.md`: honest guidance (good: classify, extract, rewrite, tag, short copy; bad: reasoning, facts, long-form, tool use) with example prompts.
- Every example under `examples/` runs with `pnpm --filter <example> start`.
- Changesets for versioning; publish workflow on tag with npm provenance.

**Accept when:** a fresh clone on macOS and Linux runs the quickstart end to end in under 5 minutes (excluding download time); `npm pack` contents contain no model files and no test fixtures.

---

## 5. Quality bar (applies to every milestone)

- **Types:** no `any` in public types; `exactOptionalPropertyTypes` clean; type tests for every public function, including Zod inference and the `ModelId` union (an invalid model id must be a compile error).
- **Errors:** 100% of public error paths produce an `InboardError` with code + hint; a unit test enumerates every code.
- **Performance targets** (record actual numbers in `docs/benchmarks.md` from `inboard bench`): default model on an Apple M-series and a 4-vCPU x64 Linux box; report load ms, first-token ms, tokens/sec and peak RSS. No hard pass/fail, but flag regressions over 20% in CI if you add a bench job.
- **Coverage:** at least 85% lines in `src/core`, `src/registry` and `src/ai` (unit suite only).
- **Bundle hygiene:** importing `inboard` must not load node-llama-cpp until first use (dynamic import), so `import` alone is cheap.

---

## 6. Out of scope for v1 (do not build)

- Browser/edge backend (keep the `Backend` interface ready for it).
- Tool calling, embeddings, image input, fine-tuning.
- A hosted service, HTTP server mode, or OpenAI-compatible endpoint (an Express example is fine; a built-in server is not).
- Any telemetry.

---

## 7. Definition of done

- [ ] All milestones' acceptance criteria met; `pnpm verify` and `pnpm test:e2e` green.
- [ ] CI green on ubuntu, macOS and Windows for Node 20 and 22.
- [ ] Public API matches Section 3 exactly, or deviations are documented in `DECISIONS.md`.
- [ ] README quickstart verified on a clean machine.
- [ ] `docs/benchmarks.md` filled with real measured numbers.
- [ ] Every registry entry has a verified URL, SHA-256 and license.
- [ ] `0.1.0` published (or ready to publish, pending owner approval). **Do not publish to npm without explicit owner approval.**
