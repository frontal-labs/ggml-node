# Models

The registry lists every model ggml-node can download. Each entry has a verified URL, SHA-256, size, context length, license and license link.

| Id | Name | Size | Context | License | Notes |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5-0.5b` | Qwen2.5 0.5B Instruct (Q4_K_M) | 491 MB | 32768 | Apache-2.0 | Default. |
| `qwen2.5-1.5b` | Qwen2.5 1.5B Instruct (Q4_K_M) | 1.12 GB | 32768 | Apache-2.0 | Better output, roughly 3× the memory. |
| `smollm2-360m` | SmolLM2 360M Instruct (Q8_0) | 386 MB | 8192 | Apache-2.0 | Smallest. Q8_0, because the Q4_K_M file is not published in that repository. |

Run `npx ggml-node list` for the current cache state.

## How a model gets into the registry

1. Its Hugging Face URL resolves and its license is checked on the Hugging Face API.
2. `bun run registry:generate` downloads the file with the resumable downloader. The downloader hashes the stream and rejects anything that does not match Hugging Face's LFS SHA-256.
3. The script reads the context length from the GGUF metadata and writes `src/registry/models.ts`.

Nothing is added on a guess. An entry with an unverified URL is not committed.

## How files are verified

- A download is streamed to `<file>.partial`, hashed as it arrives, and renamed into place only when the hash and size match.
- `ggml-node pull` re-verifies an existing file before reporting it as ready.
- `ensureModel` at load time checks the size only, for speed. A full hash runs on download and on `pull`.

## Licenses

A model with a license other than Apache-2.0 or MIT needs `acceptLicense: true` on `createGgmlNode`, and `LICENSE_NOT_ACCEPTED` is thrown until you pass it. No registry entry needs this today.

## Custom models

Pass `{ path: "./models/my-model.gguf" }` to use any GGUF file. Custom models are not verified, their license is reported as `unknown`, and their context length comes from the file's metadata.

## Embedding models

An embedding model is loaded with the same `{ path }` option. Its kind is read from the GGUF metadata: a file that declares a `pooling_type` is an embedding model, and every other file is a generation model. Check the result with `info().kind`.

```ts
const node = createGgmlNode({ model: { path: "./models/bge-small-en-v1.5-q8_0.gguf" } });
const { embeddings, dimensions } = await node.embed({ input: ["first text", "second text"] });
```

Set `kind` when the metadata is missing or wrong:

```ts
createGgmlNode({ kind: "embedding", model: { path: "./models/odd-file.gguf" } });
```

Only GGUF files work here. Tested with `bge-small-en-v1.5` (Q8_0, 384 dimensions, 512-token context).

The registry also has `bge-small-en-v1.5` (see the table in the README), so `createGgmlNode({ model: "bge-small-en-v1.5" })` downloads and verifies it like any other registry model. Its license is MIT (BAAI's original weights are MIT too, and this is a Q8_0 conversion of them).
