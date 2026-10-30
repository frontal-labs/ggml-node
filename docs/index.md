# inboard-sdk documentation

Run a small LLM inside your Node.js process. No daemon, no API key, no port.

- [Getting started](./getting-started.md): install, pull a model, generate in 30 seconds
- [API reference](./api.md): `createInboard`, options, results, events, errors
- [AI SDK provider](./ai-sdk.md): `generateText`, `streamText` and `generateObject` on a local model
- [Structured output](./structured-output.md): Zod and JSON Schema, the supported subset, and what is rejected
- [Models](./models.md): the registry, licenses, and how files are verified
- [Configuration](./configuration.md): options, environment variables, cache directory, offline mode
- [CLI](./cli.md): `pull`, `list`, `run`, `bench`, `doctor`, `cache`
- [Process isolation](./isolation.md): running the backend in a child process, and crash recovery
- [Testing](./testing.md): `inboard-sdk/testing` and the unit and e2e suites
- [Deployment](./deployment.md): Docker, Electron, serverless, air-gapped machines
- [What tiny models are good at](./what-tiny-models-are-good-at.md): honest limits and example prompts
- [Benchmarks](./benchmarks.md): measured numbers and how they were taken
- [Troubleshooting](./troubleshooting.md): error codes and their fixes
