# Development

This page is for people working on tiny-llm itself. Users of the package want [getting started](./getting-started.md).

## Setup

```sh
git clone git@github.com:frontal-labs/tiny-llm.git
cd tiny-llm
bun install
bun run verify
```

Bun 1.3.14 is the package manager and script runner (`packageManager` in `package.json`). The published package still runs on Node 20 or later.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run verify` | lint, typecheck, unit tests, build. This is what CI runs. |
| `bun run lint` | Biome check, then the Ultracite sync check |
| `bun run format` | Biome format and fix |
| `bun run typecheck` | `tsc --noEmit` over `src`, `tests`, `scripts` and the examples |
| `bun run test` | unit tests (`tests/unit`): no network, no real model |
| `bun run test:e2e` | real-model tests (`tests/e2e`). Needs `TINY_LLM_E2E=1`, a cached default model, and `bun run build` for the isolation suite |
| `bun run build` | tsup: the library, the CLI, the testing entry and the isolation worker |
| `bun run registry:generate` | downloads each registry model, verifies it against Hugging Face's LFS hash, and rewrites `src/registry/models.ts` |
| `bun run ultracite:sync` | writes `biome.json` from `ultracite.json` |
| `bun run changeset` | records a versioned change for the next release |
| `bun run prepare` | installs git hooks (husky, lint-staged, commitlint) |
| `bun run commit` | interactive Conventional Commits prompt |

## Git hooks

Hooks are installed by `bun run prepare` (run once after cloning). They run on every commit:

- **pre-commit** — `lint-staged` formats staged files with Biome and stages the fixes.
- **commit-msg** — `commitlint` rejects messages that aren't Conventional Commits.

Skip a hook with `git commit --no-verify` only for amending a message or rebasing, never to bypass a check that should pass.

## Layout

- `src/` is the library. Import it with the `@/` alias (`@/core/tiny-llm.js`). Relative imports into `src/` are not allowed.
- `src/env.ts` is the only module that reads `process.env`.
- `src/core/` holds the public handle, scheduler, prompt handling, schemas, memory preflight and structured output.
- `src/backend/` holds the `node-llama-cpp` backend and the isolated (child-process) backend.
- `src/registry/` holds the model manifest, cache resolution, the resumable downloader and `ensureModel`.
- `src/ai/` is the AI SDK provider. `src/testing/` is the mock. `src/cli/` is the command line.
- `tests/unit/`, `tests/e2e/`, `tests/helpers/` and `tests/types/` hold the tests.
- `examples/` are runnable workspace packages. `skills/` are agent skills. `docs/` is the documentation.

## Lint and configuration

Ultracite sets the lint rules. Its preset is `ultracite/biome/core`, and it runs through Biome.

`ultracite.json` is the source of truth for this repo's Ultracite setup: the preset, the agents and editors, the file globs and the formatter settings. `biome.json` is generated from it:

```sh
bun run ultracite:sync    # edit ultracite.json, then regenerate biome.json
bun run ultracite:check   # runs in lint: fails if biome.json has drifted
```

Ultracite's own CLI does not read `ultracite.json`. This script is the link, which is why the check is part of `verify`.

Where a rule cannot apply, a suppression is written on the line or the file header with a reason. Do not add a suppression without one.

## Tests

- Use the fixture server (`tests/helpers/fixture-server.ts`) for HTTP and the fake backend (`tests/helpers/fake-backend.ts`) for inference. Unit tests never touch the network.
- Compare large buffers with `Buffer.compare`. Do not assert on timing: make the failure deterministic.
- Public API types are checked at compile time in `tests/types/public-api.ts`.

## Releases

Versioning uses changesets.

1. Every user-visible change gets a changeset: `bun run changeset`. Commit it with the change.
2. When changes reach `main`, `.github/workflows/release.yml` opens a "Version Packages" pull request.
3. Merging that pull request publishes to npm with provenance. The workflow needs an `NPM_TOKEN` secret.

The release workflow splits into two jobs: `version` (bumps versions, opens the PR) and `publish` (runs `verify` again, then publishes). Nothing is published from a workstation.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the setup, commit-message rules and pull-request checklist.

## Adding a model

Follow the `registry-update` steps in `.claude/commands/registry-update.md`: edit `src/registry/sources.ts`, run `bun run registry:generate`, then `bun run verify`. Add a model only when its Hugging Face URL resolves and its license has been checked.
