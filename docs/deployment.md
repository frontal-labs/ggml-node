# Deployment

tiny-llm runs wherever Node.js 20 or later runs and the native binary loads. Three recipes follow. Test each one on the target before you rely on it.

## Docker

The recipe is in [examples/docker](../examples/docker). It pulls the model in its own image layer, so code changes do not download it again. It installs the SDK from a packed tarball, so it works before the package is on npm.

```sh
bun run build
bun pm pack                      # writes tiny-llm-<version>.tgz
docker build -f examples/docker/Dockerfile -t tiny-llm-example .
docker run --rm -p 3000:3000 tiny-llm-example
```

Notes:

- `TINY_LLM_OFFLINE=1` makes the running container refuse to download. The `model` stage puts the file in the image at build time.
- The build needs network access, to download the 491 MB model.
- The Docker daemon was not running when this example was prepared, so it has not been built in this repository.

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
import { createTinyLLM } from "tiny-llm";

const modelPath = path.join(process.resourcesPath, "models", "qwen2.5-0.5b-instruct-q4_k_m.gguf");
const ai = createTinyLLM({ model: { path: modelPath }, isolation: "process" });
```

- `isolation: "process"` is recommended in Electron, so a native crash does not take the main process down.
- `examples/electron` is a skeleton. It has not been run in this repository, because it needs a desktop session.

## Serverless

Zip-based functions (AWS Lambda zip, Vercel functions without a container) are too small for a model and the native binary. Deploy as a container image instead, with the model in an image layer, as in the Docker recipe above. Memory must cover the model plus the KV cache, so size the function accordingly.

## Air-gapped machines

Download on a connected machine, then copy the file into the cache directory:

```sh
npx tiny-llm pull qwen2.5-0.5b --dir ./models   # on a connected machine
# copy ./models/qwen2.5-0.5b-instruct-q4_k_m.gguf to the target
TINY_LLM_CACHE_DIR=/srv/models TINY_LLM_OFFLINE=1 node app.js
```

Verify the copy with `npx tiny-llm pull qwen2.5-0.5b --dir /srv/models` on the target. Pull re-checks the SHA-256 and reports a file that does not match.

## Operations

- Set `maxConcurrency` to what memory allows. Each concurrent request has its own KV cache.
- Watch `QUEUE_FULL` and `OUT_OF_MEMORY` in logs. They are the signals that capacity is short.
- `onEvent` gives you local timings for every request. Nothing leaves the process.
