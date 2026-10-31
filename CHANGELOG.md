# Changelog

## 0.2.0

### Minor Changes

- d9e2434: Publish the package as `ggml-node`. The names `tiny-llm`, `tiny-llm-node` and `tinyllm` could not be published to npm for this account, so the package, its import paths (`ggml-node/ai`, `ggml-node/testing`), its CLI (`npx ggml-node`), its cache directory and its API use the new name: `createGgmlNode`, `GgmlNode`, `ggmlNode` and `createMockGgmlNode`. The environment variables are now `GGML_NODE_CACHE_DIR`, `GGML_NODE_OFFLINE` and `GGML_NODE_E2E`. The GitHub repository is `frontal-labs/ggml-node`.

All notable changes to `ggml-node` are recorded here. Entries are generated from changesets (`bun run changeset`).

## 0.1.0 (unreleased)

First release candidate. Not yet published to npm.

- Core: `createGgmlNode` with `generate`, `stream`, `object`, `countTokens`, `info`, `ready` and `unload`. A `node-llama-cpp` backend, with lazy loading, bounded queueing, abort in both states, and overflow policies (`error`, `truncate-start`, `truncate-middle`).
- Structured output: Zod 4 or JSON Schema, compiled to a grammar. Unsupported keywords are rejected with `INVALID_OPTIONS`.
- Models: a verified registry (`qwen2.5-0.5b`, `qwen2.5-1.5b`, `smollm2-360m`), resumable downloads checked against SHA-256, offline mode, and a license gate.
- AI SDK provider (`ggml-node/ai`): `generateText`, `streamText` and `generateObject`.
- Testing (`ggml-node/testing`): deterministic mock GgmlNode and AI SDK model, with no native code.
- Process isolation: `isolation: "process"` with crash recovery and a restart budget.
- CLI: `pull`, `list`, `run`, `bench`, `doctor`, `cache`.
