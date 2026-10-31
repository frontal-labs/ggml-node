# Skills

Agent skills for working with `ggml-node`. Each folder has a `SKILL.md` with frontmatter (`name`, `description`) and instructions. Install them by copying the folders into your agent's skills directory, for example `.claude/skills/` or `.cursor/skills/`.

| Skill | Use it when |
| --- | --- |
| [ggml-node-usage](./ggml-node/usage/SKILL.md) | adding a local model to an app: `createGgmlNode`, generate, stream, errors |
| [ggml-node-structured-output](./ggml-node/structured-output/SKILL.md) | extracting or classifying into a typed object with a Zod or JSON Schema |
| [ggml-node-ai-sdk](./ggml-node/ai-sdk/SKILL.md) | using a local model with `generateText`, `streamText` or `generateObject` |
| [ggml-node-testing](./ggml-node/testing/SKILL.md) | writing unit tests for code that calls ggml-node, with `ggml-node/testing` |
| [ggml-node-operations](./ggml-node/operations/SKILL.md) | pulling models, checking a machine with `doctor`, benchmarking, and deploying |
