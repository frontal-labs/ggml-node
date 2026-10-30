# Skills

Agent skills for working with `tiny-llm`. Each folder has a `SKILL.md` with frontmatter (`name`, `description`) and instructions. Install them by copying the folders into your agent's skills directory, for example `.claude/skills/` or `.cursor/skills/`.

| Skill | Use it when |
| --- | --- |
| [tiny-llm-usage](./tiny-llm-usage/SKILL.md) | adding a local model to an app: `createTinyLLM`, generate, stream, errors |
| [tiny-llm-structured-output](./tiny-llm-structured-output/SKILL.md) | extracting or classifying into a typed object with a Zod or JSON Schema |
| [tiny-llm-ai-sdk](./tiny-llm-ai-sdk/SKILL.md) | using a local model with `generateText`, `streamText` or `generateObject` |
| [tiny-llm-testing](./tiny-llm-testing/SKILL.md) | writing unit tests for code that calls tiny-llm, with `tiny-llm/testing` |
| [tiny-llm-operations](./tiny-llm-operations/SKILL.md) | pulling models, checking a machine with `doctor`, benchmarking, and deploying |
