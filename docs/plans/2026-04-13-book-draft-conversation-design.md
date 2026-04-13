# Book Draft Conversation Design

## Goal

Fill the missing front-half interaction layer inside `interaction-control-layer` by adding a shared book-draft conversation that works in both `TUI` and `Studio Chat`.

This is not the full “creative operating system” yet. It is the first complete loop for:
- vague idea input
- iterative draft refinement
- shared draft state across shells
- explicit conversion from draft to book creation

## Scope

### Included
- shared `creationDraft` state inside the project interaction session
- natural-language ideation when no active book is bound
- `/create` to create a book from the current draft
- `/discard` to drop the current draft
- Studio Chat / TUI synchronization through the same session file

### Excluded
- full title/blurb/outline negotiation UI
- foundation diff / outline revision workflow
- automatic truth/sqlite rebuild after manual chapter edits

## Product Behavior

### No active book

When the project has no active book and the user enters freeform text, the interaction layer treats it as book ideation instead of generic chat.

Example:

```text
我想写个港风商战悬疑，主角从灰产洗白。
```

The system responds with:
- a tightened shared draft
- one focused next question

### Shared draft

The draft lives in project session state and can be resumed from:
- TUI
- Studio Chat
- external agent entrypoints

### Explicit creation

Users finalize the draft through:

```text
/create
```

This converts the shared draft into the existing structured `create_book` path.

### Explicit discard

Users can drop the draft through:

```text
/discard
```

## Architecture

### Session

`InteractionSession` gains `creationDraft`.

The draft is the single shared source of truth for:
- concept
- optional title / genre / platform / language
- optional chapter scale fields
- blurb / author intent / current focus seeds
- next question
- missing fields
- ready-to-create flag

### Routing

`routeNaturalLanguageIntent()` gets one new branch:
- if no active book is bound, unmatched freeform input routes to `develop_book`

Explicit commands:
- `/new <idea>` -> `develop_book`
- `/create` -> `create_book`
- `/discard` -> `discard_book_draft`

### Runtime

New runtime intents:
- `develop_book`
- `discard_book_draft`

`create_book` now fills missing fields from the current draft before calling the existing creation tool.

### Tools

Shared interaction tools gain `developBookDraft`.

It uses the active model to:
- merge the latest user turn into the current draft
- return a compact assistant reply
- return updated structured draft JSON

## Why This Is The Right Cut

This design gives us:
- a real front-half conversation loop
- zero duplicate shell logic
- no new standalone wizard system
- no collision with the already-working write/revise/export control paths

It is intentionally smaller than the final vision, but it closes the biggest product gap: “I can control a book, but I still can’t converse a new book into existence.”
