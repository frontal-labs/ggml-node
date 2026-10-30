# Decisions

Deviations from `PLAN.md` and the reasons for them. Each entry says what changed and why.

## D1: TypeScript pinned to 5.x (M1)

**Plan:** TypeScript strict via `typescript`.
**Change:** `typescript@^5.9` instead of the latest `7.x`.
**Why:** TypeScript 7 ships without the JavaScript compiler API (`createProgram` is undefined). tsup's declaration bundling needs that API, so `pnpm build` would fail. Revisit when tsup supports TS 7.

## D2: CI runs Node 22 and 24, not 20 (M1)

**Plan:** CI on Node 20 and 22.
**Change:** The CI matrix is Node 22 and 24. The published package still declares `engines.node >= 20`.
**Why:** `vitest@5` requires Node `^22.12 || ^24 || >=26`, so Node 20 cannot run the dev toolchain. The library runtime itself is kept Node 20 compatible, and the build target is `node20`.

## D3: Zod is matched structurally (M1)

**Plan:** `object({ schema: zodSchema })` infers `z.infer`.
**Change:** `ZodLikeSchema` is a structural type (`{ _zod: { output } }`). The library does not import `zod` at type level.
**Why:** `zod` is an optional peer dependency. Importing its types would make the published `.d.ts` require zod even for users who never use structured output. Zod 4 exposes the output type on `_zod.output`, and the type tests in `test/types/public-api.ts` check that inference against the real zod.

## D4: `ai` and `zod` are dev dependencies and optional peers (M1)

**Plan:** `peerDependencies` on `ai` and `zod`.
**Change:** Both are also listed in `devDependencies` so the tests and type checks run here. Peer ranges are `ai ^7` and `zod ^4`.
**Why:** Peer dependencies are not installed in the development environment by default.

## D5: `ModelId` is declared before the registry is complete (M1)

`src/registry/models.ts` declares the three model ids only. The typed manifest with verified URLs and checksums lands in M2, as the plan requires. Nothing unverified is committed.

## D6: Registry checksums are verified against Hugging Face's LFS hash (M2)

**Plan:** the generator downloads each file and computes its SHA-256.
**Change:** `scripts/compute-checksums.ts` reads the LFS SHA-256 and size from Hugging Face's `x-linked-etag` and `x-linked-size` headers, then downloads with the library's own resumable downloader, which hashes the stream and rejects any mismatch. The hash written to `models.ts` is therefore the one the stream was verified against, not one the script computed separately.
**Why:** the first attempt dropped its connection at 116 MB and had no resume, so the generator now reuses the production downloader (resume and retry included). The check is the same one: the bytes must hash to the value Hugging Face publishes. `scripts/compute-checksums.ts` also reads `contextLength` from each file's GGUF metadata, which is what the manifest records.

## D7: Registry scope for v1 (M2)

- `qwen2.5-0.5b` (default), `qwen2.5-1.5b`, and `smollm2-360m` are in the registry. All are Apache-2.0, confirmed from each repo's Hugging Face metadata.
- `smollm2-360m` uses the Q8_0 file. The Q4_K_M URL returns 404 in that repo, so Q4_K_M was not used.
- The optional `llama3.2-1b` entry is left out. It needs `acceptLicense`, and it would have added about 0.8 GB of downloads with no test value in v1. `LICENSE_NOT_ACCEPTED` is implemented and covered by a unit test that uses a synthetic entry.

## D8: `src/registry/ensure.ts` is an extra file (M2)

The plan lists `registry/cache.ts` and `registry/download.ts`. The offline, `autoDownload`, and license gate logic sits in `ensure.ts` so that `download.ts` stays a pure downloader.

## D9: Memory preflight uses available memory, not `os.freemem()` (M3)

**Plan:** compare the estimate with `os.freemem()` or the cgroup limit.
**Change:** available memory is `MemAvailable` on Linux, free plus inactive plus speculative pages from `vm_stat` on macOS, and `os.freemem()` elsewhere. The cgroup limit still applies when it is smaller.
**Why:** on macOS `os.freemem()` counts only truly free pages. The first real-model e2e run reported 0.14 to 0.33 GB free on a machine with about 8.8 GB available, and refused to load the 0.5 GB model. The estimate is weights (file size) plus the KV cache for `maxConcurrency` sequences at the chosen `contextSize`.

## D10: `truncate-middle` drops messages, it does not cut text (M3)

The plan does not define the policy precisely. `truncate-start` drops the oldest removable message first. `truncate-middle` keeps the first removable message and drops the one nearest the middle, so the start of the conversation and the most recent turns survive. In both policies the system message and the last user message are never removed.

## D11: Errors from the backend become `InboardError` (M3)

**Plan:** every thrown error from the public API must be an `InboardError`.
**Change:** anything the backend throws, from a request or from load, is wrapped as `BACKEND_CRASHED` (for requests) or with the same code (for load). The hint points to `inboard doctor`. The original error is kept on `cause`.

## D12: Abort semantics (M3)

- `generate()` rejects with `ABORTED`, whether the abort happened while queued or while running.
- `stream().result` resolves with `finishReason: "abort"`. While running it keeps the partial text. While queued it is empty, and nothing is run for that request. This follows the plan.
- Abort for a running request stops generation and releases the sequence.

## D13: Features not built yet in M3

- `object()` throws `INVALID_OPTIONS` until M4 (structured output).
- `isolation: "process"` throws `INVALID_OPTIONS` until M6.

## D14: Native log level is `error` (M3)

node-llama-cpp prints a warning for the `</s>` token in the Qwen 2.5 GGUF metadata on every load. The warning is harmless, so the backend logs at `error` to keep CLI and library output clean.

## D15: Coverage target (M3)

Unit-suite line coverage over `src/core`, `src/registry`, and `src/ai` is 89.7%, above the 85% target. The `src/ai` module is still a stub, so its lines are not yet covered; that number will change when M5 lands.

## D16: Structured output rejects what the grammar cannot enforce (M4)

Keywords outside the grammar builder's subset (for example `minimum`, `pattern`, `multipleOf`, or `format: "email"`) throw `INVALID_OPTIONS` at call time, naming the keyword and its path. They are never silently dropped. The same applies to a `$ref` that does not point into `#/$defs/`.

Zod is converted with Zod's own `toJSONSchema` (`io: "output"`). Two adjustments:

- `anyOf` becomes `oneOf`, which the grammar builder supports. Zod uses it for nullable and union types.
- The safe-integer bounds Zod adds to every `integer` (`-(2^53-1)` to `2^53-1`) are dropped. Every JS integer already lies inside them, so they restrict nothing. Any bound the user wrote (`.min(0)`) is kept and rejected, as above.

## D17: Zod output is validated after the grammar parse (M4)

The grammar guarantees the shape. The output is then checked with the user's Zod schema, and `object` returns the parsed value (`safeParse(...).data`) with any transforms applied. A failure is `SCHEMA_VIOLATION`. A plain JSON Schema is checked by the grammar's own validator instead.

## D18: Structured-output acceptance (M4)

`test/e2e/structured.e2e.test.ts` runs 50 classification and 50 nested-extraction calls against the default model (`INBOARD_E2E=1`). All 100 parse and validate. Run time was about 65 s on this machine.

## D19: AI SDK provider behaviour (M5)

- Unsupported input (images, files, tool calls and results, tool definitions, reasoning in history) is dropped with an `unsupported` warning. It is never a crash.
- `toolChoice` of `required` or `tool` throws `INVALID_OPTIONS`, because a tool call cannot be honoured in v1. `auto` and `none` are accepted.
- `responseFormat: json` with a schema uses the grammar path (`inboard.object`), so the output is guaranteed to match. Without a schema, the provider asks for JSON in the prompt and warns that the output is not guaranteed.
- With a JSON schema, `doStream` emits the whole object as one `text-delta`. It is not streamed token by token, because the grammar path has no streaming variant in v1.
- Abort in `doStream` maps to `finish` with `unified: "other"`, `raw: "abort"`.
- Stream parts follow `LanguageModelV4StreamPart`: `stream-start`, `text-start`, `text-delta`*, `text-end`, `finish`. Errors arrive as an `error` part. A unit test checks the order.
- `inboard(modelId, settings)` shares one provider per settings value. Functions in settings (such as `onEvent`) are left out of that key, so two calls with different callbacks but otherwise equal settings share an instance.

## D20: AI SDK v7 deprecations in the example (M5)

`examples/ai-sdk` uses `generateObject`, as the plan specifies. `ai@7` marks `generateObject` deprecated (in favour of `generateText` with an output setting) and marks the `image` content part deprecated. The example still runs. Moving to the newer API is a follow-up.

## D21: pnpm workspace (M5)

`pnpm-workspace.yaml` includes the root package and `examples/*`, so examples run with `pnpm --filter <example> start`, as the plan requires. Examples import the built `dist/`, so run `pnpm build` first.
