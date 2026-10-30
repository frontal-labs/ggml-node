# API reference

All public names are exported from `local-llm`. The AI SDK provider is `local-llm/ai`, and the test helpers are `local-llm/testing`.

## `createLocalLLM(options): LocalLLM`

Creates a handle. No model loads until the first call, or until `ready()`. Invalid options throw `LocalLLMError` (`INVALID_OPTIONS`) immediately.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `model` | `ModelId \| { path: string }` | required | A registry id, or a path to a GGUF file on disk. |
| `contextSize` | positive integer | `min(model context, 4096)` | Tokens for prompt plus output. |
| `maxConcurrency` | integer ≥ 1 | `1` | Requests running at once. Each one holds a backend sequence. |
| `maxQueue` | integer ≥ 0 | `64` | Requests waiting beyond the running ones. Overflow throws `QUEUE_FULL`. |
| `threads` | integer ≥ 1 or `"auto"` | `"auto"` | Inference threads. |
| `gpu` | `"auto"` or `false` | `"auto"` | Metal, CUDA or Vulkan when available. |
| `isolation` | `"none"` or `"process"` | `"none"` | `"process"` runs the backend in a child process. See [isolation](./isolation.md). |
| `cacheDir` | string | see [configuration](./configuration.md) | Where models are stored. |
| `offline` | boolean | `false` | Never download. `LOCAL_LLM_OFFLINE=1` also turns this on. |
| `autoDownload` | boolean | `true` | Download a missing registry model on first use. |
| `acceptLicense` | boolean | `false` | Required for a model whose license is not Apache-2.0 or MIT. |
| `onEvent` | `(event) => void` | none | Local event hook. Nothing is sent anywhere. Errors thrown by the hook are ignored. |

## `LocalLLM`

### `ready(): Promise<ModelInfo>`

Loads the model if needed, and resolves with its info. Safe to call many times.

### `generate(options): Promise<GenerateResult>`

Runs one request and resolves when it finishes. Rejects with `ABORTED` if the signal fires.

### `stream(options): StreamResult`

Returns `{ textStream, result, abort() }`. `textStream` yields text deltas. `result` resolves with the same shape as `generate()`. If the request is aborted while running, `result` resolves with `finishReason: "abort"` and the partial text. If it is aborted while queued, `result` resolves with empty text and nothing runs.

### `object(options): Promise<ObjectResult<T>>`

Generates JSON constrained to a schema and returns the parsed value. `options.schema` is a Zod 4 schema, or a plain JSON Schema object. A Zod schema gives `T` directly. A JSON Schema object gives `unknown` unless you pass a type argument: `ai.object<{ name: string }>({ schema, prompt })`. The result also has `raw`, the text as generated.

### `countTokens(text): Promise<number>`

Token count for a plain string, using the model's tokenizer.

### `info(): ModelInfo | null`

The loaded model's info, or `null` before the first load and after `unload()`.

### `unload(): Promise<void>`

Waits for requests in flight, then frees the model. The next call loads it again.

## Generate options

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `prompt` | string | | Exactly one of `prompt` or `messages`. |
| `messages` | `{ role, content }[]` | | `role` is `system`, `user` or `assistant`. |
| `system` | string | | Added as the first system message. |
| `maxTokens` | integer ≥ 1 | `256` | Output limit. |
| `temperature` | `0` to `2` | `0.7` | `0` is deterministic. |
| `topP`, `topK`, `seed` | number | | Sampling controls. `seed` gives repeatable output. |
| `stop` | string[] | | Stop sequences. |
| `overflow` | `"error"`, `"truncate-start"`, `"truncate-middle"` | `"error"` | What to do when the prompt does not fit. See below. |
| `signal` | `AbortSignal` | | Aborts the request. |

### Overflow policies

If the prompt plus `maxTokens` does not fit in `contextSize`:

- `error` throws `CONTEXT_OVERFLOW`.
- `truncate-start` drops the oldest messages first.
- `truncate-middle` drops the messages nearest the middle first, keeping the start of the conversation and the latest turns.

Both truncation policies always keep the system message and the last user message. If those two alone do not fit, the call throws `CONTEXT_OVERFLOW`.

## Results

```ts
interface GenerateResult {
  text: string;
  finishReason: "stop" | "length" | "abort";
  model: ModelId | "custom";
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  timing: {
    queueMs: number;     // time waiting for a free sequence
    loadMs: number;      // time spent loading the model in this call, else 0
    firstTokenMs: number;
    totalMs: number;
    tokensPerSecond: number;
  };
}
```

## Events

`onEvent` receives these, in order for a request: `load:start`, `load:done`, `request:queued` (only when it waits), `request:start`, then `request:done` or `request:error`. Downloads emit `download:start`, `download:progress` and `download:done`.

## Errors

Every error from the public API is an `LocalLLMError` with a `code`, a non-empty `hint`, and an optional `cause`. Use `isLocalLLMError(err)` to test for it.

| Code | When |
| --- | --- |
| `MODEL_NOT_FOUND` | The model is not cached and cannot be downloaded (offline, or `autoDownload: false`), or a custom path does not exist. |
| `DOWNLOAD_FAILED` | The network failed. Re-run the same command: the partial download resumes. |
| `CHECKSUM_MISMATCH` | A downloaded file did not match its registry SHA-256. The partial file is deleted. |
| `LICENSE_NOT_ACCEPTED` | The model's license needs `acceptLicense: true`. |
| `UNSUPPORTED_PLATFORM` | The native backend could not start on this machine. Run `doctor`. |
| `OUT_OF_MEMORY` | The preflight estimate exceeds available memory. The hint suggests a smaller model or a lower `contextSize`. |
| `CONTEXT_OVERFLOW` | The prompt does not fit, and the overflow policy does not fix it. |
| `QUEUE_FULL` | More requests are waiting than `maxQueue` allows. |
| `ABORTED` | The signal fired. |
| `SCHEMA_VIOLATION` | The output did not match the schema. Raise `maxTokens` if it was cut short. |
| `INVALID_OPTIONS` | An option is out of range, or a schema uses an unsupported keyword. The message names the field. |
| `BACKEND_CRASHED` | The backend failed. With `isolation: "process"`, the next call restarts it. |

## Exports

- Values: `createLocalLLM`, `LocalLLMError`, `isLocalLLMError`, `LOCAL_LLM_ERROR_CODES`.
- Types: `LocalLLM`, `LocalLLMOptions`, `GenerateOptions`, `GenerateResult`, `StreamResult`, `ObjectOptions`, `ObjectResult`, `ModelInfo`, `LocalLLMEvent`, `ModelId`, `Message`, `Usage`, `Timing`, `FinishReason`, `LocalLLMErrorCode`.
