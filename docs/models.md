# Models

The registry lists every model tiny-llm can download. Each entry has a verified URL, SHA-256, size, context length, license and license link.

| Id | Name | Size | Context | License | Notes |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5-0.5b` | Qwen2.5 0.5B Instruct (Q4_K_M) | 491 MB | 32768 | Apache-2.0 | Default. |
| `qwen2.5-1.5b` | Qwen2.5 1.5B Instruct (Q4_K_M) | 1.12 GB | 32768 | Apache-2.0 | Better output, roughly 3× the memory. |
| `smollm2-360m` | SmolLM2 360M Instruct (Q8_0) | 386 MB | 8192 | Apache-2.0 | Smallest. Q8_0, because the Q4_K_M file is not published in that repository. |

Run `npx tiny-llm list` for the current cache state.

## How a model gets into the registry

1. Its Hugging Face URL resolves and its license is checked on the Hugging Face API.
2. `bun run registry:generate` downloads the file with the resumable downloader. The downloader hashes the stream and rejects anything that does not match Hugging Face's LFS SHA-256.
3. The script reads the context length from the GGUF metadata and writes `src/registry/models.ts`.

Nothing is added on a guess. An entry with an unverified URL is not committed.

## How files are verified

- A download is streamed to `<file>.partial`, hashed as it arrives, and renamed into place only when the hash and size match.
- `tiny-llm pull` re-verifies an existing file before reporting it as ready.
- `ensureModel` at load time checks the size only, for speed. A full hash runs on download and on `pull`.

## Licenses

A model with a license other than Apache-2.0 or MIT needs `acceptLicense: true` on `createTinyLLM`, and `LICENSE_NOT_ACCEPTED` is thrown until you pass it. No registry entry needs this today.

## Custom models

Pass `{ path: "./models/my-model.gguf" }` to use any GGUF file. Custom models are not verified, their license is reported as `unknown`, and their context length comes from the file's metadata.
