# Changelog

All notable changes to `tiny-llm` are recorded here. Entries are generated from changesets (`bun run changeset`).

## 0.1.0 (unreleased)

First release candidate. Not yet published to npm.

- Core: `createTinyLLM` with `generate`, `stream`, `object`, `countTokens`, `info`, `ready` and `unload`. A `node-llama-cpp` backend, with lazy loading, bounded queueing, abort in both states, and overflow policies (`error`, `truncate-start`, `truncate-middle`).
- Structured output: Zod 4 or JSON Schema, compiled to a grammar. Unsupported keywords are rejected with `INVALID_OPTIONS`.
- Models: a verified registry (`qwen2.5-0.5b`, `qwen2.5-1.5b`, `smollm2-360m`), resumable downloads checked against SHA-256, offline mode, and a license gate.
- AI SDK provider (`tiny-llm/ai`): `generateText`, `streamText` and `generateObject`.
- Testing (`tiny-llm/testing`): deterministic mock TinyLLM and AI SDK model, with no native code.
- Process isolation: `isolation: "process"` with crash recovery and a restart budget.
- CLI: `pull`, `list`, `run`, `bench`, `doctor`, `cache`.
