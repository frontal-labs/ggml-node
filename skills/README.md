# Skills

Agent skills for working with `inboard-sdk`. Each folder has a `SKILL.md` with frontmatter (`name`, `description`) and instructions. Install them by copying the folders into your agent's skills directory, for example `.claude/skills/` or `.cursor/skills/`.

| Skill | Use it when |
| --- | --- |
| [inboard-usage](./inboard-usage/SKILL.md) | adding a local model to an app: `createInboard`, generate, stream, errors |
| [inboard-structured-output](./inboard-structured-output/SKILL.md) | extracting or classifying into a typed object with a Zod or JSON Schema |
| [inboard-ai-sdk](./inboard-ai-sdk/SKILL.md) | using a local model with `generateText`, `streamText` or `generateObject` |
| [inboard-testing](./inboard-testing/SKILL.md) | writing unit tests for code that calls inboard, with `inboard-sdk/testing` |
| [inboard-operations](./inboard-operations/SKILL.md) | pulling models, checking a machine with `doctor`, benchmarking, and deploying |
