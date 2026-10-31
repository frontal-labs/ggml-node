# Troubleshooting

Start with `npx ggml-node doctor`. It checks the platform, memory, cache, and that the backend loads, and it prints a fix for each problem.

## Errors by code

### `MODEL_NOT_FOUND`

The model is not cached, and it cannot be downloaded in this mode.

- Run `npx ggml-node pull qwen2.5-0.5b`.
- If you set `offline: true` or `GGML_NODE_OFFLINE=1`, pull the model on a connected machine and copy the file to the cache directory.
- If you passed a custom `{ path }`, check that the file exists.

### `DOWNLOAD_FAILED`

The network failed during a download.

- Run the same command again. The partial file is kept, and the download resumes.
- Behind a proxy or a firewall, check that `huggingface.co` is reachable.

### `CHECKSUM_MISMATCH`

A download did not match its SHA-256. The partial file was deleted.

- Run the command again. A one-off corrupted transfer is the usual cause.
- If it repeats, the registry entry may be wrong. Report it with the model id.

### `LICENSE_NOT_ACCEPTED`

The model's license needs your consent. Read the license link in the error, then pass `acceptLicense: true`.

### `OUT_OF_MEMORY`

The model and its KV cache do not fit in available memory.

- Use a smaller model, such as `smollm2-360m`.
- Lower `contextSize` (the KV cache scales with it).
- Lower `maxConcurrency` (each concurrent request has its own cache).
- Close other applications. On macOS, `doctor` shows what is available.

### `CONTEXT_OVERFLOW`

The prompt plus `maxTokens` does not fit in `contextSize`.

- Shorten the input.
- Lower `maxTokens`.
- Raise `contextSize` (up to the model's context length).
- Or set `overflow: "truncate-start"` or `"truncate-middle"`. The system and last user messages are always kept.

### `QUEUE_FULL`

More requests are waiting than `maxQueue` allows. Retry later, raise `maxQueue`, or raise `maxConcurrency` if memory allows.

### `SCHEMA_VIOLATION`

The output did not match the schema. Most often `maxTokens` was too small, so the JSON was cut short. Raise it.

### `INVALID_OPTIONS`

An option is out of range, or a schema uses a keyword the grammar cannot enforce. The message names the field or keyword. For schemas, see [structured output](./STRUCTURED_OUTPUT.md#what-is-rejected).

### `UNSUPPORTED_PLATFORM`

The native backend could not start. Run `doctor`. Check that the prebuilt binary matches your OS and CPU, and that you are not on an architecture without a prebuilt binary.

### `BACKEND_CRASHED`

The backend failed. With `isolation: "process"`, the next call restarts it. If it keeps happening, the crash loop limit has been reached: fix the cause shown in the worker's stderr, then restart the process. Without isolation, a native crash ends the process. Consider `isolation: "process"`.

## Symptoms

### The first call is very slow

The first call loads the model from disk, which can take seconds, or much longer on a machine under memory pressure. Call `ready()` at startup so the wait happens before a user is waiting. Later calls reuse the loaded model.

### Output is cut short

`finishReason` is `"length"`: the reply hit `maxTokens`. Raise it.

### A warning about `</s>` or a control token

node-llama-cpp prints this for some GGUF files. ggml-node sets the native log level to `error`, so it should not appear. If it does, it is harmless.

### `ggml-node doctor` says the backend failed to load

Its `fix:` line says what to do. Common causes are a corrupted cache file (run `npx ggml-node cache clear qwen2.5-0.5b` and pull again) and a platform the prebuilt binary does not support.

### `ggml-node` reports `error: unknown option` or `unknown command`

Run `npx ggml-node --help` for the current commands and options.
