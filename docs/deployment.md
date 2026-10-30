# Deployment

inboard runs wherever Node.js 20 or later runs and the native binary loads. Three recipes follow. Test each one on the target before you rely on it.

## Docker

Pull the model in its own layer, so rebuilds that change code do not download it again.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim AS model
WORKDIR /models
RUN npx --yes inboard-sdk pull qwen2.5-0.5b --dir /models

FROM node:22-slim AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY --from=model /models /models
ENV INBOARD_CACHE_DIR=/models
ENV INBOARD_OFFLINE=1
CMD ["node", "dist/server.js"]
```

- `INBOARD_OFFLINE=1` makes the container refuse to download at runtime, so a missing model fails fast instead of stalling.
- Make sure the `dist/` folder includes the isolation worker, because `isolation: "process"` forks it. The default build does.
- The `examples/docker` folder has a complete, working version.

## Electron

The native binaries and the model must sit outside the packed `asar` archive, and the model path must come from the packaged resources.

```json
// package.json (electron-builder)
"build": {
  "asarUnpack": [
    "**/node_modules/node-llama-cpp/**",
    "**/node_modules/@node-llama-cpp/**",
    "resources/models/**"
  ],
  "extraResources": [{ "from": "models", "to": "models" }]
}
```

```ts
// main process
import { app } from "electron";
import path from "node:path";
import { createInboard } from "inboard-sdk";

const modelPath = path.join(process.resourcesPath, "models", "qwen2.5-0.5b-instruct-q4_k_m.gguf");
const ai = createInboard({ model: { path: modelPath }, isolation: "process" });
```

- `isolation: "process"` is recommended in Electron, so a native crash does not take the main process down.
- `examples/electron` is a skeleton. It has not been run in this repository, because it needs a desktop session.

## Serverless

Zip-based functions (AWS Lambda zip, Vercel functions without a container) are too small for a model and the native binary. Deploy as a container image instead, with the model in an image layer, as in the Docker recipe above. Memory must cover the model plus the KV cache, so size the function accordingly.

## Air-gapped machines

Download on a connected machine, then copy the file into the cache directory:

```sh
npx inboard pull qwen2.5-0.5b --dir ./models   # on a connected machine
# copy ./models/qwen2.5-0.5b-instruct-q4_k_m.gguf to the target
INBOARD_CACHE_DIR=/srv/models INBOARD_OFFLINE=1 node app.js
```

Verify the copy with `npx inboard pull qwen2.5-0.5b --dir /srv/models` on the target. Pull re-checks the SHA-256 and reports a file that does not match.

## Operations

- Set `maxConcurrency` to what memory allows. Each concurrent request has its own KV cache.
- Watch `QUEUE_FULL` and `OUT_OF_MEMORY` in logs. They are the signals that capacity is short.
- `onEvent` gives you local timings for every request. Nothing leaves the process.
