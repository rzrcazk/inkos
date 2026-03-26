# Hook Payoff and English Variance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix v2 hook/payoff control so long books stop accumulating pseudo-progress hooks, and add pre-write English variance guidance that reduces repeated mechanism-restatement chapters.

**Architecture:** Extend governed planning with a hook agenda, tighten settlement semantics so mention and advancement are no longer conflated, widen governed settlement visibility to include stale hook debt, and feed a compact long-span variance brief into the writer before English drafting. Keep the LLM in charge of prose; use structure only to control debt, admission, and repetition pressure.

**Tech Stack:** TypeScript, Node.js, Vitest, Zod, existing planner/composer/writer/settler/state-reducer pipeline

---

### Task 1: Add hook agenda and mention semantics to schemas

**Files:**
- Modify: `packages/core/src/models/input-governance.ts`
- Modify: `packages/core/src/models/runtime-state.ts`
- Test: `packages/core/src/__tests__/models.test.ts`

**Step 1: Write the failing tests**

- Add schema tests for:
  - `ChapterIntent.hookAgenda.mustAdvance`
  - `ChapterIntent.hookAgenda.eligibleResolve`
  - `ChapterIntent.hookAgenda.staleDebt`
  - `ChapterIntent.hookAgenda.avoidNewHookFamilies`
  - `RuntimeStateDelta.hookOps.mention`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/models.test.ts`

Expected: schema parse failure for missing fields or missing `mention` support.

**Step 3: Write minimal implementation**

- Extend `ChapterIntentSchema` with a `hookAgenda` object and safe defaults.
- Extend `HookOpsSchema` with `mention: string[]`.
- Export the new types from existing model files.

**Step 4: Run test to verify it passes**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/models/input-governance.ts packages/core/src/models/runtime-state.ts packages/core/src/__tests__/models.test.ts
git commit -m "feat: add hook agenda and mention schemas"
```

### Task 2: Build hook governance utilities

**Files:**
- Create: `packages/core/src/utils/hook-governance.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/hook-governance.test.ts`

**Step 1: Write the failing tests**

- Add tests covering:
  - stale hook debt detection from hook records
  - hook admission gate rejecting duplicate/restated hook candidates
  - chapter-local disposition classification: mention vs advance vs resolve vs defer

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/hook-governance.test.ts`

Expected: missing module.

**Step 3: Write minimal implementation**

- Add helpers for:
  - computing stale debt hooks
  - checking whether a new hook candidate is payoff-bearing
  - comparing a new hook candidate against active-hook payoff text
  - classifying whether a chapter event is mention-only or true advancement

**Step 4: Run test to verify it passes**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/utils/hook-governance.ts packages/core/src/index.ts packages/core/src/__tests__/hook-governance.test.ts
git commit -m "feat: add hook governance utilities"
```

### Task 3: Teach Planner to emit hook agenda

**Files:**
- Modify: `packages/core/src/agents/planner.ts`
- Modify: `packages/core/src/utils/memory-retrieval.ts`
- Test: `packages/core/src/__tests__/planner.test.ts`
- Test: `packages/core/src/__tests__/memory-retrieval.test.ts`

**Step 1: Write the failing tests**

- Add planner tests showing:
  - recent active hooks can be selected into `mustAdvance`
  - stale unresolved hooks can be selected into `staleDebt`
  - clearly mature hooks can be listed under `eligibleResolve`
  - the agenda is rendered into `intent.md`

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/planner.test.ts src/__tests__/memory-retrieval.test.ts`

Expected: intent shape mismatch / rendered intent missing agenda details.

**Step 3: Write minimal implementation**

- Use active hook selection plus stale debt detection to build a bounded `hookAgenda`.
- Keep the selection small: 1-2 `mustAdvance`, 0-1 `eligibleResolve`, 1-2 `staleDebt`.
- Render a compact agenda block into planner runtime output.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/agents/planner.ts packages/core/src/utils/memory-retrieval.ts packages/core/src/__tests__/planner.test.ts packages/core/src/__tests__/memory-retrieval.test.ts
git commit -m "feat: add hook agenda to planner intent"
```

### Task 4: Expand governed settlement working set with agenda and debt hooks

**Files:**
- Modify: `packages/core/src/utils/governed-working-set.ts`
- Modify: `packages/core/src/agents/writer.ts`
- Test: `packages/core/src/__tests__/writer.test.ts`
- Test: `packages/core/src/__tests__/composer.test.ts`

**Step 1: Write the failing tests**

- Add tests showing governed settlement includes:
  - selected hooks
  - recent hooks
  - planner `mustAdvance`
  - planner `eligibleResolve`
  - planner `staleDebt`

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/writer.test.ts src/__tests__/composer.test.ts`

Expected: working set excludes planner debt hooks.

**Step 3: Write minimal implementation**

- Extend `buildGovernedHookWorkingSet()` so it unions selected, recent, and agenda hooks.
- Pass planner intent into the working-set builder during governed settlement.
- Keep the returned snapshot bounded and deterministic.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/utils/governed-working-set.ts packages/core/src/agents/writer.ts packages/core/src/__tests__/writer.test.ts packages/core/src/__tests__/composer.test.ts
git commit -m "feat: expose stale hook debt in governed settlement"
```

### Task 5: Tighten Settler output semantics and reducer behavior

**Files:**
- Modify: `packages/core/src/agents/settler-prompts.ts`
- Modify: `packages/core/src/agents/settler-delta-parser.ts`
- Modify: `packages/core/src/state/state-reducer.ts`
- Test: `packages/core/src/__tests__/settler-delta-parser.test.ts`
- Test: `packages/core/src/__tests__/state-reducer.test.ts`

**Step 1: Write the failing tests**

- Add tests for:
  - `mention` parsing
  - mention-only hook rows not mutating `lastAdvancedChapter`
  - true advancement mutating `lastAdvancedChapter`
  - duplicate "restated hook as new hook" being rejected at reducer layer if classified as duplicate family

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/settler-delta-parser.test.ts src/__tests__/state-reducer.test.ts`

Expected: parser and reducer do not understand `mention` or duplicate-admission rejection.

**Step 3: Write minimal implementation**

- Update settler instructions so:
  - mention does not count as advancement
  - new hooks require future-payoff significance
  - resolve and defer are explicit dispositions
- Parse the new payload shape.
- Keep reducer semantics strict: mention is no-op for chapter advancement; advance and resolve mutate state; defer must keep hook open but labeled.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/agents/settler-prompts.ts packages/core/src/agents/settler-delta-parser.ts packages/core/src/state/state-reducer.ts packages/core/src/__tests__/settler-delta-parser.test.ts packages/core/src/__tests__/state-reducer.test.ts
git commit -m "feat: separate hook mention from advancement"
```

### Task 6: Add hook health warnings for pseudo-progress and debt

**Files:**
- Create: `packages/core/src/utils/hook-health.ts`
- Modify: `packages/core/src/agents/writer.ts`
- Modify: `packages/core/src/pipeline/runner.ts`
- Test: `packages/core/src/__tests__/hook-health.test.ts`
- Test: `packages/core/src/__tests__/pipeline-runner.test.ts`

**Step 1: Write the failing tests**

- Add tests for warnings on:
  - too many active hooks
  - several chapters with no real advancement
  - stale hooks without disposition
  - bursts of new hooks without any old-hook resolution

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/hook-health.test.ts src/__tests__/pipeline-runner.test.ts`

Expected: no hook-health warnings emitted.

**Step 3: Write minimal implementation**

- Create a hook-health analyzer over structured hook state and current chapter delta.
- Feed warnings into the existing audit/reporting path.
- Keep warnings informative, not blocking.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/utils/hook-health.ts packages/core/src/agents/writer.ts packages/core/src/pipeline/runner.ts packages/core/src/__tests__/hook-health.test.ts packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "feat: add hook debt and pseudo-progress warnings"
```

### Task 7: Add English long-span variance brief before writing

**Files:**
- Modify: `packages/core/src/utils/long-span-fatigue.ts`
- Modify: `packages/core/src/agents/writer-prompts.ts`
- Modify: `packages/core/src/agents/writer.ts`
- Test: `packages/core/src/__tests__/long-span-fatigue.test.ts`
- Test: `packages/core/src/__tests__/writer-prompts.test.ts`

**Step 1: Write the failing tests**

- Add tests showing the variance brief can surface:
  - high-frequency phrases across recent chapters
  - repeated first-clause patterns
  - repeated ending beat shapes
  - a scene obligation string

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/long-span-fatigue.test.ts src/__tests__/writer-prompts.test.ts`

Expected: no pre-write variance brief exists.

**Step 3: Write minimal implementation**

- Extend long-span fatigue analysis to emit a compact variance brief instead of warnings only.
- Feed the brief only where useful, especially for English governed writing.
- Add scene obligations such as confrontation, negotiation, concealment, aftermath, or discovery under pressure.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/utils/long-span-fatigue.ts packages/core/src/agents/writer-prompts.ts packages/core/src/agents/writer.ts packages/core/src/__tests__/long-span-fatigue.test.ts packages/core/src/__tests__/writer-prompts.test.ts
git commit -m "feat: add english pre-write variance guidance"
```

### Task 8: Strengthen dialogue-pressure guidance without hard quotas

**Files:**
- Modify: `packages/core/src/agents/writer-prompts.ts`
- Modify: `packages/core/src/agents/post-write-validator.ts`
- Test: `packages/core/src/__tests__/writer-prompts.test.ts`
- Test: `packages/core/src/__tests__/post-write-validator.test.ts`

**Step 1: Write the failing tests**

- Add tests for:
  - prompt guidance that asks for resistance-bearing exchanges when multi-character scenes are present
  - validator warnings when a multi-character chapter contains almost no direct exchange

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/writer-prompts.test.ts src/__tests__/post-write-validator.test.ts`

Expected: prompt and validator have no such guidance.

**Step 3: Write minimal implementation**

- Add prompt language that prefers conflict-bearing dialogue rather than simple information transfer.
- Keep validator soft-warning only; do not enforce a hard global percentage threshold.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/agents/writer-prompts.ts packages/core/src/agents/post-write-validator.ts packages/core/src/__tests__/writer-prompts.test.ts packages/core/src/__tests__/post-write-validator.test.ts
git commit -m "feat: guide dialogue pressure in multi-character scenes"
```

### Task 9: Add end-to-end governed tests for hook payoff and variance control

**Files:**
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`
- Modify: `packages/core/src/__tests__/writer.test.ts`

**Step 1: Write the failing tests**

- Add governed pipeline tests covering:
  - planner emits hook agenda
  - governed settlement sees debt hooks
  - mention does not count as progress
  - a stale hook can be deferred with reason
  - English pre-write variance brief appears in prompt assembly

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts src/__tests__/writer.test.ts`

Expected: governed flow assertions fail.

**Step 3: Write minimal implementation**

- Wire any missing integration pieces uncovered by the tests.
- Keep test fixtures small and mock-driven.

**Step 4: Run tests to verify they pass**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/__tests__/pipeline-runner.test.ts packages/core/src/__tests__/writer.test.ts
git commit -m "test: cover hook payoff control in governed pipeline"
```

### Task 10: Run focused acceptance verification

**Files:**
- Modify: `docs/plans/2026-03-26-hook-payoff-and-english-variance-design.md`
- Modify: `docs/plans/2026-03-26-hook-payoff-and-english-variance-implementation-plan.md`

**Step 1: Run targeted automated tests**

Run:

```bash
pnpm --filter @actalk/inkos-core test -- src/__tests__/models.test.ts src/__tests__/hook-governance.test.ts src/__tests__/planner.test.ts src/__tests__/writer.test.ts src/__tests__/pipeline-runner.test.ts src/__tests__/long-span-fatigue.test.ts src/__tests__/writer-prompts.test.ts src/__tests__/post-write-validator.test.ts
```

Expected: PASS

**Step 2: Run a governed smoke for one Chinese and one English book**

Run the existing project smoke/accept commands with v2 enabled and verify:

- hook counts stop exploding
- at least one real resolution or explicit defer appears
- English prompt contains variance guidance
- no legacy path is used unless explicitly requested

**Step 3: Record results**

- Update these docs with actual outcomes, gaps, and any task ordering changes discovered during implementation.

**Step 4: Commit**

```bash
git add docs/plans/2026-03-26-hook-payoff-and-english-variance-design.md docs/plans/2026-03-26-hook-payoff-and-english-variance-implementation-plan.md
git commit -m "docs: record hook payoff redesign verification"
```
