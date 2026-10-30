# Decisions

Deviations from `PLAN.md` and the reasons for them. Each entry says what changed and why.

## D1: TypeScript pinned to 5.x (M1)

**Plan:** TypeScript strict via `typescript`.
**Change:** `typescript@^5.9` instead of the latest `7.x`.
**Why:** TypeScript 7 ships without the JavaScript compiler API (`createProgram` is undefined). tsup's declaration bundling needs that API, so `pnpm build` would fail. Revisit when tsup supports TS 7.

## D2: CI runs Node 22 and 24, not 20 (M1)

**Plan:** CI on Node 20 and 22.
**Change:** The CI matrix is Node 22 and 24. The published package still declares `engines.node >= 20`.
**Why:** `vitest@5` requires Node `^22.12 || ^24 || >=26`, so Node 20 cannot run the dev toolchain. The library runtime itself is kept Node 20 compatible, and the build target is `node20`.

## D3: Zod is matched structurally (M1)

**Plan:** `object({ schema: zodSchema })` infers `z.infer`.
**Change:** `ZodLikeSchema` is a structural type (`{ _zod: { output } }`). The library does not import `zod` at type level.
**Why:** `zod` is an optional peer dependency. Importing its types would make the published `.d.ts` require zod even for users who never use structured output. Zod 4 exposes the output type on `_zod.output`, and the type tests in `test/types/public-api.ts` check that inference against the real zod.

## D4: `ai` and `zod` are dev dependencies and optional peers (M1)

**Plan:** `peerDependencies` on `ai` and `zod`.
**Change:** Both are also listed in `devDependencies` so the tests and type checks run here. Peer ranges are `ai ^7` and `zod ^4`.
**Why:** Peer dependencies are not installed in the development environment by default.

## D5: `ModelId` is declared before the registry is complete (M1)

`src/registry/models.ts` declares the three model ids only. The typed manifest with verified URLs and checksums lands in M2, as the plan requires. Nothing unverified is committed.
