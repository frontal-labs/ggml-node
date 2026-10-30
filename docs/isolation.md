# Process isolation

By default the native backend runs inside your process. A crash in the native code takes the process down. `isolation: "process"` runs the backend in a child process instead.

```ts
const ai = createTinyLLM({ model: "qwen2.5-0.5b", isolation: "process" });
```

The API, the result shapes and the errors are the same. Only the place where inference runs changes.

## How it works

- The host forks `dist/backend/isolated/worker-main.js` on the first request, and keeps the child for later ones.
- Requests and replies go over IPC as typed JSON messages. The child streams deltas back as they are produced.
- Abort signals are forwarded to the child, which stops generating.
- Grammar output is decoded and checked in the child, so the native grammar never leaves it.

## When a child crashes

- Requests in flight fail with `BACKEND_CRASHED`.
- The next request starts a new child and reloads the model. The caller does not do anything.
- At most 3 restarts happen in 60 seconds. After that the backend stays stopped and every call fails with `BACKEND_CRASHED`, and the hint says to fix the cause and restart the process. A crash loop is not hidden.

These limits are the defaults. The internal `createIsolatedBackend` takes `maxRestarts` and `restartWindowMs`.

## When the parent exits

The child exits when its parent disconnects, so no model is left loaded in the background. The host also stops its children on process exit, and `unload()` stops the child.

## Trade-offs

- Memory: the child holds the model, so the parent stays small. Two processes together use somewhat more than one.
- Startup: the first request also pays for starting the child process, on top of the model load. Measure it on your target before you rely on a number.
- Runtime: the worker runs under the same Node as the host, so the built package must be installed with its `dist/` folder.

## Diagnosing a crash

The child's stderr is inherited, so native errors appear in your terminal. `npx tiny-llm doctor` runs the backend in-process and shows whether the native binary loads at all.
