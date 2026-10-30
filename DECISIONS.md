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
