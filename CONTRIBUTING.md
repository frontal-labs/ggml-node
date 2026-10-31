# Contributing to node-slm

Thanks for your interest. node-slm is pre-release software; please keep changes small and reviewable.

## Development setup

```sh
git clone git@github.com:frontal-labs/node-slm.git
cd node-slm
bun install
bun run prepare   # installs git hooks (husky, lint-staged, commitlint)
```

Hooks run on every commit:

- **pre-commit** — `lint-staged` formats staged files with Biome.
- **commit-msg** — `commitlint` rejects messages that aren't Conventional Commits.

## Local checks

```sh
bun run verify        # lint, typecheck, unit tests, build
bun run test:e2e     # real-model tests (needs NODE_SLM_E2E=1 + cached model)
```

## Commit messages

Use Conventional Commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `perf`, `revert`, `style`. Keep the subject under 72 characters.

```sh
bun run commit           # interactive conventional-commit prompt
```

## Pull requests

Use the template. A PR should touch the docs whenever it changes an option, error code, CLI flag, or environment variable — the matching page in `docs/` must keep step with the code.

## Releases

Releases are automated by `release.yml` from `main`. Add a changeset with `bun run changeset` before merging; the Version Packages PR is opened automatically.

## Reporting issues

Use the bug report template. Include your OS, Node version, node-slm version, the model you used, and the output of `node-slm doctor`.