# Interaction Create/Export Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the remaining shared interaction-layer work by wiring `create_book` and `export_book` into the shared runtime and moving Studio's create/export flows onto the same execution path.

**Architecture:** Keep the existing natural-language interaction path for chat/TUI/OpenClaw, but add a structured interaction entrypoint for UI-driven actions. Shared runtime tools will own create/export behavior so CLI, Studio, and external agents can reuse the same capability surface.

**Tech Stack:** TypeScript, Vitest, Hono, Commander, InkOS core pipeline/session tooling.

---

### Task 1: Add failing core tests for create/export runtime behavior

**Files:**
- Modify: `packages/core/src/__tests__/interaction-runtime.test.ts`
- Modify: `packages/core/src/__tests__/project-interaction.test.ts`

**Step 1: Write failing tests**

- Add a runtime test proving `create_book` calls a new `createBook` tool, binds the created book, and returns its summary text.
- Add a runtime test proving `export_book` calls a new `exportBook` tool with format/approved-only options and returns export metadata text.
- Add a project-control test proving structured interaction requests persist session updates for `create_book`.

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir packages/core exec vitest run \
  src/__tests__/interaction-runtime.test.ts \
  src/__tests__/project-interaction.test.ts
```

Expected: failing tests due to missing runtime tool methods / structured request helper.

### Task 2: Implement shared create/export runtime support

**Files:**
- Modify: `packages/core/src/interaction/intents.ts`
- Modify: `packages/core/src/interaction/runtime.ts`
- Modify: `packages/core/src/interaction/project-control.ts`
- Modify: `packages/core/src/interaction/project-tools.ts`

**Step 1: Extend interaction request/runtime contracts**

- Add structured fields for create/export:
  - `title`
  - `genre`
  - `platform`
  - `chapterWordCount`
  - `targetChapters`
  - `format`
  - `approvedOnly`
  - `outputPath`
- Add runtime tool methods:
  - `createBook`
  - `exportBook`

**Step 2: Implement structured project interaction helper**

- Add `processProjectInteractionRequest(...)` alongside the existing natural-language helper.
- It should:
  - load session
  - optionally bind `activeBookId`
  - execute `runInteractionRequest`
  - persist the updated session

**Step 3: Implement create/export tool behavior**

- `createBook`:
  - derive a book config
  - call `PipelineRunner.initBook`
  - return interaction metadata with `responseText`
- `exportBook`:
  - centralize the existing CLI export logic into the shared tool
  - return output path / exported chapter count in interaction metadata

**Step 4: Run tests**

Run:

```bash
pnpm --dir packages/core exec vitest run \
  src/__tests__/interaction-runtime.test.ts \
  src/__tests__/project-interaction.test.ts
```

Expected: PASS.

### Task 3: Add CLI routing/tests for shared create/export

**Files:**
- Modify: `packages/core/src/interaction/nl-router.ts`
- Modify: `packages/core/src/__tests__/interaction-nl-router.test.ts`
- Modify: `packages/cli/src/__tests__/interact-command.test.ts`

**Step 1: Write failing tests**

- Add NL routing coverage for:
  - `/new <title>`
  - `/export`
  - `/export md`
- Add interact command coverage for structured/shared export output where useful.

**Step 2: Implement minimal routing**

- Route slash commands into `create_book` / `export_book`.
- Keep this scoped to explicit commands, not full ideation.

**Step 3: Run tests**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-nl-router.test.ts
pnpm --dir packages/cli exec vitest run src/__tests__/interact-command.test.ts
```

Expected: PASS.

### Task 4: Move Studio create/export endpoints onto shared interaction execution

**Files:**
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/api/server.test.ts`

**Step 1: Write failing tests**

- Add server tests proving:
  - `/api/books/create` routes through shared structured interaction execution
  - `/api/books/:id/export-save` routes through shared structured interaction execution

**Step 2: Implement endpoint changes**

- Use the same shared interaction tools built from pipeline + state.
- Replace direct `initBook` / custom export-save logic with calls to the shared structured helper.
- Preserve existing response shape expected by the Studio UI.

**Step 3: Run tests**

Run:

```bash
pnpm --dir packages/studio exec vitest run src/api/server.test.ts
```

Expected: PASS.

### Task 5: Final verification

**Files:**
- No new files

**Step 1: Run focused test/build suite**

```bash
pnpm --dir packages/core exec vitest run \
  src/__tests__/interaction-runtime.test.ts \
  src/__tests__/project-interaction.test.ts \
  src/__tests__/interaction-nl-router.test.ts
pnpm --dir packages/cli exec vitest run src/__tests__/interact-command.test.ts
pnpm --dir packages/studio exec vitest run src/api/server.test.ts
pnpm --dir packages/core run build
pnpm --dir packages/cli run build
pnpm --dir packages/studio run build
```

Expected: all green.

**Step 2: Commit**

```bash
git add packages/core/src/interaction packages/core/src/__tests__ \
  packages/cli/src/__tests__/interact-command.test.ts \
  packages/studio/src/api/server.ts packages/studio/src/api/server.test.ts \
  docs/plans/2026-04-10-interaction-create-export-runtime.md
git commit -m "feat(interaction): add shared create and export flows"
```
