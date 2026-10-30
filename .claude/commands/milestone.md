---
description: Work the next unfinished milestone in PLAN.md
---

Read `PLAN.md` and `DECISIONS.md`. Find the first milestone whose acceptance criteria are not yet met.
Implement it, run `bun run verify`, and for milestones that need the real model run `LOCAL_LLM_E2E=1 bun run test:e2e`.
Record every deviation in `DECISIONS.md`, then commit with a conventional message.
