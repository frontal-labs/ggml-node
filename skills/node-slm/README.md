# Skills

Agent skills for working with `node-slm`. Each folder has a `SKILL.md` with frontmatter (`name`, `description`) and instructions. Install them by copying the folders into your agent's skills directory, for example `.claude/skills/` or `.cursor/skills/`.

| Skill | Use it when |
| --- | --- |
| [node-slm-usage](./usage/SKILL.md) | adding a local model to an app: `createNodeSlm`, generate, stream, errors |
| [node-slm-structured-output](./structured-output/SKILL.md) | extracting or classifying into a typed object with a Zod or JSON Schema |
| [node-slm-ai-sdk](./ai-sdk/SKILL.md) | using a local model with `generateText`, `streamText` or `generateObject` |
| [node-slm-testing](./testing/SKILL.md) | writing unit tests for code that calls node-slm, with `node-slm/testing` |
| [node-slm-operations](./operations/SKILL.md) | pulling models, checking a machine with `doctor`, benchmarking, and deploying |
