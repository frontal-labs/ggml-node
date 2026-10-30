---
description: Add or refresh a model in the registry
---

1. Edit `src/registry/sources.ts`. Only add a model whose Hugging Face URL resolves and whose license you have checked.
2. Run `bun run registry:generate`. The script verifies each file against Hugging Face's LFS SHA-256.
3. Run `bun run verify`, then update `docs/` if the model list in the docs changed.
