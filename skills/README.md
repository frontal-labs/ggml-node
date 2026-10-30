# Skills

Agent skills for working with `local-llm`. Each folder has a `SKILL.md` with frontmatter (`name`, `description`) and instructions. Install them by copying the folders into your agent's skills directory, for example `.claude/skills/` or `.cursor/skills/`.

| Skill | Use it when |
| --- | --- |
| [local-llm-usage](./local-llm-usage/SKILL.md) | adding a local model to an app: `createLocalLLM`, generate, stream, errors |
| [local-llm-structured-output](./local-llm-structured-output/SKILL.md) | extracting or classifying into a typed object with a Zod or JSON Schema |
| [local-llm-ai-sdk](./local-llm-ai-sdk/SKILL.md) | using a local model with `generateText`, `streamText` or `generateObject` |
| [local-llm-testing](./local-llm-testing/SKILL.md) | writing unit tests for code that calls local-llm, with `local-llm/testing` |
| [local-llm-operations](./local-llm-operations/SKILL.md) | pulling models, checking a machine with `doctor`, benchmarking, and deploying |
