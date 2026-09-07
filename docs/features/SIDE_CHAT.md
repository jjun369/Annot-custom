# Independent side chat

## Why it exists

`사이드채팅` is an optional scratch surface for a 20–30 minute reading session. It is useful for a free question, a short-lived thought, or a deliberate second explanation that should not become part of the active PDF conversation.

## Local PageDock AI

The Reader's `사이드채팅` action opens a separate Electron popup. The popup stores `sidechat` sessions in the root `.annot/sessions.json` file, with independent messages and provider session state. Closing the window does not delete its history; `새 대화` creates a new record. A side-chat turn is saved locally before Codex or Claude runs, so a provider error or 429 does not erase the question or its draft.

Side-chat AI runs with no implicit Library, PDF, Knowledge, or folder-tool context. A source is available only when the reader deliberately hands over a bounded selection. The popup explains that it is a separate conversation and does not silently copy the active PDF history.

The PageDock question composer is kept as a local draft. The web-answer text and optional model label are also kept in device-local `localStorage` under a bounded key for the active side-chat question, session, and web provider, so switching tabs or closing and reopening the popup does not move a draft to another task. These convenience drafts are not session JSON and are not included in portable backups; a successfully saved perspective is the durable record.

## Web tabs and manual handoff

The first web registry contains official top-level destinations for [DeepSeek](https://chat.deepseek.com/), [ChatGPT](https://chatgpt.com/), [Claude](https://claude.ai/), and [Gemini](https://gemini.google.com/). Electron uses an isolated provider-specific web view partition when the current runtime can host it; a load or security failure opens the same official destination in the system browser. Login state is not inferred.

The user chooses one outbound mode:

- `질문만`: the current question.
- `선택 원문 + 질문`: the bounded selected text and question.
- `원문 + 질문 + 답변`: the selected text, question, and a PageDock assistant answer explicitly chosen for review.

PageDock shows the exact prompt and has separate `내용 복사` and `웹 AI 열기` actions. It never automatically sends, reads the web page, polls for a reply, or reads cookies. The user pastes a response into the popup, optionally types a model label marked `확인 안 됨`, and explicitly saves it. Each saved response remains additive and can be compared with the first PageDock explanation when one exists; no winner, consensus, answer grading, Knowledge promotion, or highlight resolution is created.

The handoff panel keeps the current question, provider, bounded page cue, and exact request state visible, while request selection, prompt preview, model metadata, and answer import details can be opened when needed. `질문 복사` and `답변 가져오기` remain independent recovery actions. A pasted draft is never silently truncated; an over-limit response is retained locally with an explicit save error until it is shortened.

Both the single-answer and comparison views offer an optional `내 이해 / 아직 확인할 점` field. An explicit save stores one `sideChatReflection` on the canonical sidechat user question, with a timestamp. It is kept only in this independent side conversation, is excluded from all outbound PageDock/web prompts, and is never propagated to PDF highlights, Knowledge, cards, or resolution state. The existing session lock applies the patch against the latest session, and the optional field travels through the existing portable session backup without a SQLite or manifest change.

If a saved question is visible and the user starts typing a new question, the new composer text becomes the web target and is saved locally before copy/open. A prior question, answer, provider, or prompt mode is not silently reused for that new draft; selecting a saved question again remains an explicit recovery action.

## Source and backup contract

A handoff preserves `documentId`, page, normalized rectangles, selection text, and `highlightId` in the question's `sourceContext`; `sourcePdfPath` is only a relative path hint used to reopen the Reader. Source return prefers document identity and updates the hint after a rename. If the document is gone, the popup keeps its question and explains that the source cannot be reopened.

Side-chat fields are optional additions to the existing session JSON. Portable backup v2 includes the root `.annot/sessions.json` automatically, and v1 sessions continue to load. No SQLite table, sidecar, backup manifest, or legacy `/chat-window` behavior changes.
