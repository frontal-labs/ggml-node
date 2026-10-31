---
name: node-slm-operations
description: Operate node-slm on a real machine or in a container. Covers pulling and verifying models, the doctor and bench commands, air-gapped installs, Docker and Electron, and reading the CLI exit codes.
---

# node-slm-operations

## Commands

```sh
npx node-slm pull qwen2.5-0.5b          # download and verify (resumes if interrupted)
npx node-slm list                       # cache state and licenses
npx node-slm doctor                     # platform, memory, cache, and a backend check
npx node-slm bench qwen2.5-0.5b --tokens 128
npx node-slm cache path
```

Exit codes: `0` success, `1` usage error, `2` environment error or a failed `doctor` check.

## Rules

- Run `doctor` first when something fails. Its `fix:` lines are specific.
- `doctor` warns when the default model is not cached. That is not a failure.
- For air-gapped machines, pull on a connected machine with `--dir`, copy the file, set `LOCAL_LLM_CACHE_DIR` and `LOCAL_LLM_OFFLINE=1`, and run `pull` on the target to verify it.
- In Docker, pull the model in its own image layer, and set `LOCAL_LLM_OFFLINE=1` at runtime. See `examples/docker`.
- In Electron, unpack the native binaries from the asar archive and read the model from `process.resourcesPath`. Use `isolation: "process"`. See `examples/electron`.
- Serverless functions that are zip-based cannot hold a model. Use a container image.
- Benchmarks depend heavily on the machine's free memory. Run `bench` on a quiet machine, and record the conditions. See `docs/BENCHMARKS.md`.
- Do not publish to npm from a workstation. The release workflow publishes from `main` after approval.
