---
"ggml-node": minor
---

Publish the package as `ggml-node`. The names `tiny-llm`, `tiny-llm-node`, `tinyllm` and `node-slm` could not be published to npm for this account, so the package, its import paths (`ggml-node/ai`, `ggml-node/testing`), its CLI (`npx ggml-node`), its cache directory and its API use the new name: `createGgmlNode`, `GgmlNode`, `ggmlNode` and `createMockGgmlNode`. The environment variables are now `GGML_NODE_CACHE_DIR`, `GGML_NODE_OFFLINE` and `GGML_NODE_E2E`. The GitHub repository is `frontal-labs/ggml-node`.
