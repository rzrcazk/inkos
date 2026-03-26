# Hook Payoff and English Variance Redesign

## Goal

Improve InkOS v2 long-book quality by fixing the hook/payoff control loop and by reducing English long-span repetition without replacing the writing pipeline with hard rules.

## Problem Statement

The latest 30-chapter acceptance runs show the same structural failure in two different surface forms:

1. Hook tables look active, but payoff delivery is weak.
2. English chapters stay length-stable, but drift toward repeated mechanism restatement and familiar sentence shapes.

The underlying issue is not "the model forgot to be creative." The issue is that the system currently rewards the wrong things.

### Current Hook Failure Mode

The v2 pipeline already improved context trimming, retrieval, and structured state safety, but the hook loop still has four bad incentives:

1. Too many things become hooks.
   A clue, suspicion, or restated implication can be promoted into `pending_hooks.md` even when it is not a real future-payoff obligation.
2. Mention and advance are conflated.
   A hook can be treated as "progressed" even when the chapter only rephrases an old implication or points at the same problem from a slightly different angle.
3. Planner does not schedule payoff work.
   `PlannerAgent` chooses chapter intent, but it does not tell the writer or settler which old hooks should be advanced, deferred, or resolved in this chapter.
4. Settler sees an incomplete governed hook set.
   Composer retrieval can surface stale unresolved hooks, but governed settlement still narrows its working set to selected hooks plus a recent window. Debt hooks can still miss the final settlement step.

This creates the exact pattern seen in the Chinese acceptance run:

- hook count grows too fast
- many rows are marked as "持续推进" or "暂缓" while the notes say "无新增" or "待回收"
- almost nothing resolves

That is not healthy continuity. It is pseudo-progress.

### Current English Failure Mode

The English book has a different surface failure:

- chapter length is stable
- AI tell markers are low
- but the book keeps reusing the same sentence skeletons and the same "explain the mechanism one more time" climax shape

This happens because the system currently does much more post-write warning than pre-write guidance for long-span variance. It can detect fatigue after the fact, but it does not feed a compact, chapter-local variance brief into the writer before drafting.

## Scope

This redesign applies to the v2 governed writing path.

In scope:

- Hook admission rules for `pending_hooks`
- Hook agenda generation in planner
- Governed settlement visibility for stale hook debt
- Distinguishing mention from real hook advancement
- Hook debt warnings in audit
- English pre-write variance guidance

Out of scope:

- Legacy mode behavior changes
- A mandatory database runtime
- A new reviewer agent
- Hard "resolve one hook every N chapters" quotas
- A heavy workflow engine or finite-state machine for story logic

## Design Principles

1. Keep prose decisions with the LLM.
2. Add structure only where the current system is rewarding bad behavior.
3. A hook is a future-payoff obligation, not a generic clue bucket.
4. Mention is not advancement.
5. Resolve only when earned, not because the calendar says so.
6. Pre-write variance guidance is better than post-write punishment.
7. v2 should get stricter; legacy can stay loose.

## Proposed Design

## 1. Add a Hook Admission Gate

The system needs a smaller, stricter definition of what belongs in `pending_hooks`.

A new hook should be admitted only if all of the following are true:

- it creates a concrete unresolved question or obligation that reasonably survives beyond the current chapter
- it is not just a restatement of an existing active hook
- it has a plausible payoff horizon

If the candidate fails that gate, it should not become a new hook. It should instead go to one of these places:

- `chapterSummary.hookActivity`
- current-state facts
- notes for an existing hook

This is the main control that reduces hook explosion.

### Why This Matters

Right now the system is implicitly rewarding "open more rows." That makes the hook table look rich while weakening actual book-level payoff. A smaller active hook set is better than a larger decorative one.

## 2. Add Hook Agenda to Planner Intent

Planner should stop being hook-neutral.

`ChapterIntent` should gain a small structured hook agenda, for example:

```json
{
  "hookAgenda": {
    "mustAdvance": ["H019"],
    "eligibleResolve": ["H045"],
    "staleDebt": ["H023", "H027"],
    "avoidNewHookFamilies": [
      "anonymous-source-restatement",
      "mechanism-restatement"
    ]
  }
}
```

This is not a rigid script. It is a bounded control brief.

Planner's job becomes:

- pick 1-2 active hooks that this chapter should materially move
- expose 0-1 hooks that are now eligible for payoff
- surface 1-2 stale debt hooks that have been ignored too long
- tell the chapter not to open duplicate hook families

This keeps the writer focused without forcing a chapter outline.

## 3. Expand the Governed Settlement Hook Working Set

Governed settlement should no longer use only:

- hooks selected into context
- hooks within a recent chapter window

It should instead use the union of:

- selected hooks from retrieval
- recent hooks
- planner `mustAdvance`
- planner `eligibleResolve`
- planner `staleDebt`

That closes the retrieval blind spot where Composer may surface a stale hook, but Settler still fails to process it.

## 4. Distinguish Mention, Advance, Resolve, and Defer

`RuntimeStateDelta.hookOps` currently supports `upsert`, `resolve`, and `defer`, but in practice the system still overuses narrative restatement as fake advancement.

The delta model should explicitly distinguish:

- `mention`: the chapter references the hook, but no state change happens
- `advance`: the hook's information state changes
- `resolve`: the payoff lands or the obligation closes
- `defer`: the hook remains open, but the system records that it is intentionally delayed

This prevents a chapter from updating `lastAdvancedChapter` just because it nodded at an old idea.

### Practical Rule

`lastAdvancedChapter` changes only on real `advance`.

If a hook is merely visible in the chapter, record a mention or do nothing. Do not pretend it progressed.

## 5. Add Hook Debt Health Checks

We should not impose a blind rule like "resolve one hook every N chapters." That would create fake payoffs.

We should add a softer but still enforceable health rule:

- if an active hook stays stale too long, the system must at least disposition it
- the disposition can be `advance`, `resolve`, or `defer`
- `defer` requires a reason, not an empty placeholder

This creates debt pressure without forcing artificial closure.

Warnings should focus on:

- too many active hooks
- too many chapters with no real hook advancement
- too many stale hooks with no disposition
- suspicious growth where several new hooks appear while no old ones resolve

## 6. Add English Pre-Write Variance Guidance

The English issue should not be solved with a giant banlist.

Instead, the writer should receive a compact variance brief before drafting:

- high-frequency phrase warnings across the last 20-30 chapters
- repeated sentence-opening patterns
- overused chapter-ending beat shapes
- a chapter-local scene obligation

Example scene obligations:

- confrontation
- negotiation
- pursuit
- concealment
- aftermath
- discovery under pressure

This prevents English chapters from all climaxing as "Mara restates the mechanism one level more clearly."

### Dialogue Guidance

Do not enforce a global dialogue percentage.

Do require that if a chapter contains multiple active characters, it should usually include at least one resistance-bearing exchange:

- someone pushes back
- someone withholds
- someone misreads intent
- someone pressures status or legitimacy

This is a better anti-monotony control than raw quote density.

## Data Flow Changes

### Planning

`PlannerAgent`

- reads current state plus active hooks
- computes hook debt
- emits `hookAgenda` inside `ChapterIntent`
- renders the agenda into `intent.md`

### Composition

`ComposerAgent`

- keeps current retrieval behavior
- includes hook agenda in the governed package indirectly through chapter intent and selected hook evidence

### Writing

`WriterAgent`

- receives the hook agenda and English variance brief
- uses them as bounded controls, not outline replacement

### Settlement

`Settler`

- sees selected + recent + agenda + stale debt hooks
- cannot treat "restated concern" as automatic advancement
- emits `mention/advance/resolve/defer` semantics

### Audit

- warns on hook bloat
- warns on pseudo-progress
- warns on stale debt without disposition
- warns on English long-span phrase fatigue and repeated beat shape

## Non-Goals

This redesign is deliberately not trying to:

- make every hook deterministic
- cap writer freedom with strict per-chapter quotas
- solve all prose quality issues with validators
- move product control into SQLite

SQLite may remain useful as an acceleration layer, but it is not the solution to hook quality. The real fix is better state semantics and better pre-write control.

## Expected Outcomes

If this design works, the next 30-chapter acceptance should show:

- materially fewer active hooks
- non-zero real resolutions in Chinese and English
- fewer "no new movement" rows masquerading as progress
- lower English phrase recurrence across chapters
- more variation in chapter scene shape
- more stable book-level payoff rhythm without heavier rules

## Rollout Strategy

Roll out only on v2.

Legacy mode can keep current behavior.

That keeps the redesign targeted and makes acceptance results easier to compare:

- old v2 behavior
- new v2 behavior
- legacy fallback if needed for debugging
