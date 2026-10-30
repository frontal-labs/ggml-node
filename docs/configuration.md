# Configuration

## Options

Every option is passed to `createLocalLLM` (or to `localLLM(modelId, settings)` for the AI SDK). The full list, with defaults, is in the [API reference](./api.md#generate-options). Options are validated with zod when the handle is created, and a bad value throws `INVALID_OPTIONS` naming the field.

## Environment variables

The library reads its environment through one module (`src/env.ts`), validated with `@t3-oss/env-core` and zod. These are the variables it reads:

| Variable | Used for | Notes |
| --- | --- | --- |
| `LOCAL_LLM_CACHE_DIR` | Where models are stored | Overrides the OS default. Lower priority than the `cacheDir` option. |
| `LOCAL_LLM_OFFLINE` | Never download | `1`, `true`, `yes` or `on` turn it on. `0`, `false` and similar turn it off. Any other value throws `INVALID_OPTIONS`. |
| `XDG_CACHE_HOME` | Linux cache location | Default `~/.cache`. Used only when `LOCAL_LLM_CACHE_DIR` is unset. |
| `LOCALAPPDATA` | Windows cache location | Default `%USERPROFILE%\AppData\Local`. |
| `LOCAL_LLM_E2E` | Test suites only | Set to `1` to run the tests that need the real model. |

Precedence for the cache directory: `cacheDir` option, then `LOCAL_LLM_CACHE_DIR`, then the OS default.

## Cache directory

| Platform | Default |
| --- | --- |
| macOS | `~/Library/Caches/local-llm` |
| Linux | `$XDG_CACHE_HOME/local-llm`, or `~/.cache/local-llm` |
| Windows | `%LOCALAPPDATA%\local-llm\cache` |

Run `npx local-llm cache path` to see the one in use.

## Offline mode

Offline mode forbids every download. A model that is not cached then fails with `MODEL_NOT_FOUND`, and the hint says what to copy. Turn it on with `offline: true` or `LOCAL_LLM_OFFLINE=1`. An explicit `offline: false` does not override the environment variable.

## Memory

Before loading, local-llm estimates the memory a model needs: its file size, plus a KV cache for `contextSize` tokens across `maxConcurrency` sequences. It compares that with available memory. Available memory is the kernel's `MemAvailable` on Linux, free plus inactive plus speculative pages on macOS, and `os.freemem()` elsewhere. Inside a cgroup, the container limit applies when it is lower.

If the estimate does not fit, loading fails with `OUT_OF_MEMORY` before any allocation. The hint suggests a smaller model, a lower `contextSize`, or a lower `maxConcurrency`.

## Concurrency and queueing

Each concurrent request holds one backend sequence, and each sequence holds its own KV cache. `maxConcurrency` sets how many run at once. Extra requests wait in a FIFO queue of at most `maxQueue`. Beyond that they fail with `QUEUE_FULL`, so the queue cannot grow without limit.
