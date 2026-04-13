# Book Draft Conversation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared book-draft ideation loop so TUI and Studio Chat can converge a vague story idea into a structured create-ready draft.

**Architecture:** Extend `InteractionSession` with `creationDraft`, route no-active-book freeform input into a new `develop_book` runtime intent, and reuse the existing `create_book` runtime/tool path for finalization.

**Tech Stack:** TypeScript, Vitest, Zod, existing interaction runtime/session/tooling.

---

### Task 1: Add shared draft state and intents

**Files:**
- Modify: `packages/core/src/interaction/session.ts`
- Modify: `packages/core/src/interaction/intents.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/interaction-models.test.ts`

### Task 2: Route ideation input

**Files:**
- Modify: `packages/core/src/interaction/nl-router.ts`
- Modify: `packages/core/src/interaction/project-control.ts`
- Test: `packages/core/src/__tests__/interaction-nl-router.test.ts`

### Task 3: Implement runtime + tools

**Files:**
- Modify: `packages/core/src/interaction/runtime.ts`
- Modify: `packages/core/src/interaction/project-tools.ts`
- Test: `packages/core/src/__tests__/interaction-runtime.test.ts`
- Test: `packages/core/src/__tests__/project-interaction.test.ts`

### Task 4: Surface shared draft in Studio Chat

**Files:**
- Modify: `packages/studio/src/components/ChatBar.tsx`
- Test: `packages/studio/src/components/chatbar-state.test.ts`

### Task 5: Verify

Run:

```bash
pnpm --dir packages/core exec vitest run \
  src/__tests__/interaction-models.test.ts \
  src/__tests__/interaction-nl-router.test.ts \
  src/__tests__/interaction-runtime.test.ts \
  src/__tests__/project-interaction.test.ts
pnpm --dir packages/studio exec vitest run \
  src/components/chatbar-state.test.ts \
  src/api/server.test.ts
pnpm --dir packages/core run build
pnpm --dir packages/cli run build
pnpm --dir packages/studio run build
```
