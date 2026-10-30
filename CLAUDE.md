# local-llm

@AGENTS.md

## Project notes for Claude

- Package: `local-llm` (Apache-2.0). Repo: `frontal-labs/local-llm`.
- Use `bun` for every script and install. Do not use npm, pnpm or yarn in this repo.
- Import source with the `@/` alias (`@/core/local-llm.js`). Relative imports into `src/` are not allowed.
- The only file that reads `process.env` is `src/env.ts`.
- Lint rules come from Ultracite. Edit `ultracite.json`, then run `bun run ultracite:sync`. Do not edit `biome.json` by hand: `bun run lint` fails when it drifts.
- Tests: `bun run test` (unit, no network) and `bun run test:e2e` (real model, needs `LOCAL_LLM_E2E=1`).
- Documentation is in `docs/`. Keep it in step with the code: a change to an option, error code, CLI flag or env variable updates the matching page.
- Plan: `PLAN.md`. Every deviation from it, with its reason: `DECISIONS.md`.
- Do not publish, push or delete anything without explicit approval.
