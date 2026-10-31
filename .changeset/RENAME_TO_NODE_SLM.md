---
"node-slm": minor
---

Publish the package as `node-slm`. The names `tiny-llm`, `tiny-llm-node` and `tinyllm` could not be published to npm for this account, so the package, its import paths (`node-slm/ai`, `node-slm/testing`), its CLI (`npx node-slm`), its cache directory and its API use the new name: `createNodeSlm`, `NodeSlm`, `nodeSlm` and `createMockNodeSlm`. The environment variables are now `NODE_SLM_CACHE_DIR`, `NODE_SLM_OFFLINE` and `NODE_SLM_E2E`. The GitHub repository is `frontal-labs/node-slm`.
