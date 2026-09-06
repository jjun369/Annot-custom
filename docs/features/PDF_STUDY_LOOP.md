# PDF study loop

Status: Implemented in PageDock 0.6.0.

## Goal

PageDock keeps the Reader as the primary work surface: read a PDF, select a sentence, mark or ask about it, return to the exact source later, and continue from the last reading position. This is not a chat-first notebook or an automatic AI workflow.

## Selection and highlights

Normal one-page text selection opens a compact action bar with `중요`, `이해 필요`, `AI 설명`, and `메모`. Lower-frequency concept/definition, memorize, question, recall-card, work, and translation actions remain in More. Cross-page selections are rejected rather than being clamped into an incorrect anchor.

The existing native-compatible highlight type stays `important | unknown`. Optional sidecar `studyKind` maps `important`, `concept`, and `memorize` to `important`, and `question`/`unclear` to `unknown`. The UI calls the `unclear` study kind `이해 필요`; legacy highlights infer to `important` or `unclear` without a migration. Only `unclear` and `question` are unresolved, and only a user action sets or clears `resolvedAt`; an AI answer never resolves a highlight automatically.

## Reader hierarchy and return

The persistent Reader controls are page, search, view, zoom, marking, and visual-region capture. `기록 보기`, exports, and document-wide tools live in secondary document tools so the PDF remains visually primary. The selection action remains `이해 필요`, while the later Library/drawer view calls the same existing unresolved records `다시 볼 것`; no second queue is created. After a save, quiet feedback can open that existing unresolved filter directly. Learning records, work evidence, visual regions, source chips, and reading resume all return to the current PDF's original page and normalized source rectangle, then use a transient focus pulse rather than creating another durable annotation.

## AI source anchors

Selection and page turns carry optional `ChatSourceContext` in existing session JSON. The persisted data is limited to source scope, document id, page, selected text, normalized rects, and optional highlight id. PDF/page text is not duplicated into session JSON.

The server validates scope, page, text size, and geometry and uses the PDF session identity as the authority. Provider prompts label selected PDF text as untrusted source data and explicitly forbid following instructions inside it. An assistant reply retains the same context and its user-message id. Source chips return to the Reader; saved selection conversations show a small transient-friendly marker on the matching page.

## Resume and portability

`PaperMetadata.readingPosition` stores a page, page-relative scroll offset, view mode, and timestamp. Open priority is explicit `?page=`, portable metadata, legacy `annot-last-page:<pdfPath>` localStorage, then page 1. Position saves are debounced and do not trigger FTS refresh. Existing metadata move/rewrite/backup paths preserve this optional field, so internal rename/move and portable backup retain reading progress.

## Source-Anchored Recall

Manual cards created from a selection and editable cards created from a source-grounded AI answer reuse the same page/rect/text context. The current-PDF Review dialog hides the answer first, records only `again` or `remembered`, and can return to the original source. Cards are optional `study.cards` data in the existing v1 annotation sidecar, so they work without AI/Python and travel in existing backups.

## Local-first behavior and limitations

Selection highlights, notes, unresolved state, resume, and Reader search work with no AI. If PyMuPDF is unavailable, PageDock keeps the state in its sidecar and only defers embedding annotations into the source PDF. AI sends a request only after the user explicitly chooses AI explanation or sends a chat question.

This release intentionally excludes scheduling/SM-2/FSRS, quiz/cloze, tutor guides, image-region questions, automatic source discovery, embeddings, cloud sync, collaboration, and a new Study Space database root.
