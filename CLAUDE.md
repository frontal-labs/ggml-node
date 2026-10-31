# node-slm

@AGENTS.md

## Project notes for Claude

- Package: `node-slm` (Apache-2.0). Repo: `frontal-labs/node-slm`.
- Use `bun` for every script and install. Do not use npm, pnpm or yarn in this repo.
- Import source with the `@/` alias (`@/core/node-slm.js`). Relative imports into `src/` are not allowed.
- The only file that reads `process.env` is `src/env.ts`.
- Lint rules come from Ultracite. Edit `ultracite.json`, then run `bun run ultracite:sync`. Do not edit `biome.json` by hand: `bun run lint` fails when it drifts.
- Tests: `bun run test` (unit, no network) and `bun run test:e2e` (real model, needs `NODE_SLM_E2E=1`).
- Documentation is in `docs/`. Keep it in step with the code: a change to an option, error code, CLI flag or env variable updates the matching page.
- Git hooks: `bun run prepare` installs them. pre-commit runs lint-staged (Biome on staged files); commit-msg runs commitlint (Conventional Commits). `bun run commit` opens the interactive prompt. Never commit with `--no-verify` to bypass a check.
- Changesets: `bun run changeset` before merging; `release.yml` opens the Version Packages PR and publishes on merge.
- Do not publish, push or delete anything without explicit approval.
