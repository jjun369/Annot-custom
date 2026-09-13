# Changelog

## 0.9.3 — Visual Knowledge notes

- Added deliberate local PNG/JPEG image memos for diagrams, circuit captures, and photographs: one short explanation plus a 10 MB-or-smaller image is retained in the existing Knowledge inbox without an OCR or AI vision step.
- Kept visual bytes separate from Knowledge JSON as integrity-checked content-addressed `.annot/knowledge-assets` files, so duplicate images are stored once while the same caption with another diagram is not lost to text-only deduplication.
- Projected explicitly selected image memos into the existing read-only mobile PDF and retained them through the existing portable backup v2 collector. Unselected images never enter the phone copy; a corrupt/missing image produces an honest return-to-Windows notice.
- Preserved Knowledge format 2, SQLite schema 1, annotation-sidecar version 1, portable-backup manifest v2, AI text-only boundary, and passive NAS snapshot design. Image files are never automatically sent to an AI or web provider.

## 0.9.2 — NAS safety snapshots

- Added an opt-in, device-local NAS protection target for a Windows-accessible folder such as a mapped Synology SMB share. PageDock first completes and verifies its local PDF-excluding portable v2 backup, then copies and SHA-256-checks a partial ZIP before publishing it in `PageDock-Backups/Auto`.
- The active Library, `.annot` sidecars, sessions, and SQLite database remain local. A NAS copy failure is visible in Settings but never delays a Reader save or invalidates a successful local backup. NAS credentials, URLs, account tokens, live sync, and direct NAS database/PDF access are not introduced.
- Separate snapshot retention is fourteen successful automatic generations; it never overwrites a different same-name archive. Existing local/bridge retention and portable backup v1/v2 compatibility are unchanged.

## 0.9.1 — Reading and recall usability

- Added local source-record search, semantic-kind filtering, and result navigation without changing source anchors or study state.
- Added a finite current-PDF recall practice flow, temporary answer scratchpad, keyboard actions, and guarded asynchronous loading/mutations.
- Prevented Korean IME confirmation Enter from submitting PDF/side-chat questions; comparison notes now use the latest question and guard unsaved closure.
- Bounded expanded web-AI controls and clarified the full-app-restart limitation of unsaved local drafts.
- Included explicit mobile Knowledge selection, recovery regressions, and a Korean 20-minute study quickstart; source and recoverable backups remain separate from phone reading copies.

## Unreleased — Provenance-gated Knowledge promotion

- Extended the mobile reading shelf with explicitly selected standalone Knowledge topics and captured memos, including a searchable summary picker. The existing read-only PDF/receipt and conflict safeguards remain separate from full ZIP recovery; unselected notes and side-chat history are not implicitly exported.

- Simplified the sidechat web handoff surface around independent `질문 복사` and `답변 가져오기` actions. Request details and the exact outbound preview remain recoverable, while draft answers are kept intact and visibly rejected at the 80,000-character boundary instead of being silently truncated.
- Added an optional sidechat-only `내 이해 / 아직 확인할 점` reflection on the canonical user question. It is explicitly saved with the existing locked session mutation, survives existing backup round trips, remains separate from PDF/Knowledge/highlight state, and is excluded from PageDock/web outbound prompts.
- Verified the packaged Windows Reader directly with a synthetic two-page PDF: both pages render readable text, page navigation and zoom work, text selection can be highlighted and memoed, the independent side-chat returns to the exact source page, and a restart retains the PDF/reading position/annotation. No user data or real web-AI send was used.
- Fixed a scroll-mode PDF re-entry race: document load now prepares the saved page and adjacent shells and restores the saved page after the shells mount, so a persisted page opens readable in the first Reader view instead of requiring a manual page change.
- Completed the second-AI follow-up review: side-chat web requests now persist immutable prompt/answer/source snapshots with stable ids, explicit independent-vs-review intent, copy acknowledgement, and request-bound imports. Saved requests and pasted explanations survive reload and remain portable through the existing session backup v1/v2 paths without changing SQLite or the manifest.
- Hardened side-chat re-entry and native web tabs: local question saves are single-flight/idempotent, draft keys include the Library/session/request or bounded unsaved target, edited drafts are revision-safe, stale session/request operations cannot select or clear a newer task, and the Electron `WebContentsView` controller single-flights loads, clamps bounds, hides on overlays/minimize, and cleans up each provider independently.
- Hardened side-chat re-entry: a newly typed question cannot inherit an older web target, web answer/model drafts stay scoped to their session/question/provider across popup reopen, and stale embedded-tab loads or native views cannot overwrite the current tab/overlay.
- Added an independent `사이드채팅` Electron popup. Its local `sidechat` sessions, PageDock AI turns, drafts, and provider state stay outside PDF conversation history; a bounded Reader selection can be handed over without automatic sending, and source return preserves document identity/page/rects.
- Added explicit semi-manual web-AI tabs for DeepSeek, ChatGPT, Claude, and Gemini. Each uses a separate provider partition or safe system-browser fallback, shows the exact outbound mode/prompt, and accepts only a user-pasted response. Saved explanations are additive, labelled as direct paste with unknown model metadata when applicable, and never auto-score or promote content.
- Hardened session persistence for overlapping Chat/DeepSeek writers: per-`sessions.json` locking and latest-read domain patches preserve concurrent messages, imports, and other-session updates, while delete/rename/move writers share the same boundary and cannot resurrect a removed session from stale state.
- Made the manual DeepSeek bridge recoverable before the first AI answer: an explicit bounded selection question is saved in the existing PDF session first, survives a primary quota/offline failure, retries by stable request ID, and can hold a single manual explanation on the user anchor without creating a fake assistant or provider session. Existing assistant-linked imports continue to compare only when a real primary answer exists.
- Made the DeepSeek manual bridge re-entry safe: every persisted selection-anchored answer can reopen `답변 붙여넣기`, drafts are preserved per task during the app session, question-copy and web-open recover independently, repeated identical imports are idempotent, and older imported answers remain selectable.
- Improved the comparison view with the original question, collapsible excerpt/page return, shared chat Markdown/math rendering, factual acquisition labels, response-length guidance, and keyboard Escape/focus trap/restore. Codex connection validation now checks auth/model catalogs without executing a real turn and distinguishes login-only from confirmed model availability.
- Fixed Codex connection for the OpenCodex Windows app: when the logged-in desktop app exposes only its protected internal binary, PageDock now uses the existing ChatGPT OAuth account session through the Codex account transport instead of treating the account as unavailable. Connection validation checks the authenticated model catalog without spending a turn, and fallback chat reuses the bounded saved conversation. Provider errors such as exhausted usage limits are shown as plain-language guidance.
- Fixed the collapsed library rail: the old vertical `탐색기` label could render Korean glyphs upside down or visually broken, so the narrow state now uses a stable folder icon with a tooltip instead of rotated text.
- Hardened Windows PDF rendering for otherwise valid documents that can show a blank page in Electron: PageDock now disables PDF.js worker-side OffscreenCanvas/image-decoder acceleration in favor of the stable canvas path, and it remounts the current document once after a transient page-render failure without losing Reader state.
- Refined the Reader after a screen-by-screen visual review without changing any persisted format: selection actions now anchor below the end of the selected source (and flip above only at the viewport edge); unresolved amber marks gain a subtle darker boundary so they cannot be confused with the operating system's blue live selection; and the record drawer contracts to 288px below 1440px while retaining the wider desktop reading layout.
- Made figure, table, and equation recording source-visible: the editor is now a keyboard-contained responsive right sheet rather than a source-covering popup, so a reader can keep the original page in view while assigning a type and optional memo. Escape and outside-click close it when no save is in progress.
- Re-established Reader-first navigation presentation: Library remains the sole prominent top-level work area, while existing Research and Knowledge destinations live under a compact `더보기` menu. Names, routes, data, and every existing workflow remain unchanged.
- Added an explicit DeepSeek Web Manual Bridge for a second, user-requested view of an existing selection-anchored PDF answer. It previews and copies only that selection plus the original question, opens an isolated DeepSeek web session for direct user login/send, and accepts only a user-pasted answer back into the same local session for a non-judgmental side-by-side comparison. It never automates the web chat, reads web content or credentials, promotes knowledge, resolves study state, changes SQLite, or changes the backup manifest.
- Tightened the short-session Reader return path without adding a dashboard: Library rows now show the existing saved page, unresolved count, and last-read date; opening remains a deliberate user action and restores the existing resume position.
- Made the Library re-entry choice calmer: its top `계속 읽기` card has one primary `이어서 읽기` action, while `다시 볼 것 N` is a small link that opens the same PDF's existing unresolved drawer filter. `이해 필요` remains the in-reading mark; later views use `다시 볼 것` and explicit `이해 완료` wording without creating a second queue or study state.
- Closed the visible unresolved loop in the Reader record drawer: an anchored `이해 필요` item can be returned to its source and explicitly marked understood in place. This never invokes AI or creates a recall card automatically.
- Reduced AI-first and management-heavy wording without changing storage: the application title, Research analysis action, and Knowledge navigation now foreground reading, personal memos, and user review while retaining clear pre-action remote-AI disclosure.
- Separated the Settings surface into clearly labelled `휴대폰에서 읽기` and `PageDock 복구 백업` panels. Mobile output remains a one-way read-only PDF; every existing manual/automatic backup and restore entry point remains visible.
- Added a provider-neutral Mobile Bridge for a user-selected external folder. An explicit stable-document mobile shelf generates a phone-width `PageDock-Mobile.pdf` with selectable Reader records, clearly labelled user notes/AI answers, recall cards, source-linked Knowledge, and disposable rendered visual regions. It never copies the live Library or persists visual crops.
- Refined the Mobile Bridge as a deliberate derived-artifact workflow: automatic mobile publication is opt-in and defaults off, relevant projected changes persist as a visible dirty state, and opted-in publishes use a 90-second debounce plus a ten-minute minimum interval. Original Library save, mobile-snapshot publish, and full backup now use distinct language and state feedback; normal external-folder failure receives one delayed retry, while external modification or deletion blocks automatic replacement.
- Added SHA-256 receipt/conflict handling for the mobile PDF: externally changed output blocks automatic replacement until the user explicitly preserves the modified pair under `Mobile/Conflicts`.
- Hardened automatic backup publication: local snapshots are written as partial ZIPs, fully reopened and manifest-verified before publication, then copied byte-identically to configured bridge `Backups/Auto`. Local and bridge automatic snapshots independently retain three successes; bridge manual full ZIPs include PDFs and are never auto-pruned.
- Automatic metadata backups now retain the latest three snapshots, while manually downloaded full ZIP backups remain outside automatic cleanup.
- Softened the Windows study surface from cool system blue-gray to a quiet paper-neutral hierarchy. Important, needs-understanding, resolved, AI-reference, and real-error treatments now use separate muted roles and continue to include text/icon state cues rather than relying on color.
- Made the Reader selection action bar smaller and source-centered, with compact icons and less visually dominant AI styling. Improved the no-document, inline Reader-search, and global-search guidance so a reader can take the next local action without guessing.
- Reframed Knowledge presentation without changing its provenance or review contract: `정리된 노트`, `바뀐 점`, `AI 초안 · 확인 전`, and `다시 볼 표시` communicate personal review rather than an approval workflow or AI truth claim. Research filename metadata gaps now reassure the user that reading and local saving still work.
- Refined the Reader around the source-first loop: the document title now keeps a compact current-page cue, `기록 보기` moved into secondary document tools, and a new `이해 필요` save can open the unresolved record filter directly. The selection bar now consistently reads `중요 / 이해 필요 / AI 설명 / 메모`.
- Made the PDF AI trust strip quieter and more exact: it keeps the selected PDF scope visible, states that personal/work/Knowledge memos are excluded, and avoids a repeated confirmation dialog. Knowledge review cards now visibly separate `AI 초안 · 확인 전` from the personally confirmed note and its manual recheck state.
- Made the study loop's destinations explicit: after a learning, work, or visual save, the Reader status offers `기록에서 보기` and opens the matching non-resizing record view; the PDF chat composer now labels the exact source scope sent for this turn and that personal/work/Knowledge notes are excluded by default.
- Refined the Reader command hierarchy without changing stored study data: primary selection actions are now important, needs-understanding, note, and ask-AI; semantic, review, work, and translation actions remain available from More. Reader records now use a non-resizing right overlay drawer with reading/learning, work, and visual-region views. Visual-region capture opens a compact source-adjacent editor and keeps passive region outlines subtle until selected or focused.
- Clarified the Knowledge boundary in the composer: a captured memo stays in the local inbox until the user explicitly runs `원격 AI로 정리`; provenance is labeled as source/context metadata rather than truth or trust, and the remote-AI connection state is secondary instead of a persistent warning.
- Added durable visual-region anchors for figure, table, equation, process-condition, and custom PDF areas. They use only stable document identity, page-relative rectangle, user kind/memo, and timestamps in the existing `.annot` sidecar; crop images, thumbnails, OCR, AI interpretation, SQLite schema changes, and backup-manifest changes remain out of scope.
- Added explicit, review-gated promotion from a PDF highlight or persisted AI answer into the existing local Knowledge inbox. Promotion preserves the existing source anchor and can include the highlight memo; it never creates a wiki revision directly.
- Added provenance classes for `문헌 주장`, `업무 관찰`, `개인 가설`, and `AI 추론`, plus optional original-date and AI-answer metadata. They are additive optional fields in the existing format-2 knowledge JSON; SQLite schema, backup manifest, and legacy JSON read behavior are unchanged.
- Added an intentionally narrow manual `재검토 표시` / `재검토 완료` flow. It records human attention without changing a topic body, `updatedAt`, or revision. Publication age never automatically creates expiry, stale, or truth state.

## 0.9.0 — 2026-08-31

- Added a current-PDF Evidence → Work Item loop for professional technical reading. A highlight can optionally be classified as `finding`, `verify`, `discuss`, or `try`; its existing note remains the interpretation or follow-up text, while Verify/Discuss/Try may be marked done independently of study `resolvedAt`.
- Added a compact Work filter in the existing highlight list and a separate Evidence Brief Markdown export. It includes only promoted source highlights, groups Findings/open/completed follow-ups, and links each item back to the existing `?pdf=&page=` Reader location.
- Stored only optional `workKind` and `workDoneAt` fields inside existing v1 annotation sidecars. No SQLite schema, sidecar version, backup manifest, task database, network service, or AI/Python dependency was added.
- Refined the Reader follow-through UI into independent learning/work record views, with exact-source cards, a footer-only secondary Ask for existing highlights, Library resume/unresolved/open-work summaries, and one responsive auxiliary slot for Chat or reading records. The Evidence Brief preview now uses that same work selector while preserving work-only Markdown export.

## 0.8.0 — 2026-08-31

- Added source-anchored manual Cloze cards. A learner selects a PDF sentence, then explicitly chooses one short original-text span to hide; the current-PDF Today queue, review dates, and exact source return are reused unchanged.
- Stored only optional `kind: "cloze"` plus `clozeText`/`clozeStart`/`clozeEnd` inside the existing v1 `study.cards` sidecar. Missing `kind` remains the prior basic recall card without a read-time migration; SQLite schema 1 and backup manifest v2 remain unchanged.
- Kept Cloze fully local and self-rated: no AI generation, automatic grading, multi-cloze, quiz choices, global study dashboard, or adaptive SRS.

## 0.7.0 — 2026-08-31

- Added a compact, current-PDF `오늘 복습` queue to Source-Anchored Recall. New cards are due today; `다시` returns a card tomorrow and `기억함` in three calendar days.
- Stored only optional date-only `review.nextReviewDate` state in the existing v1 `study.cards` sidecar. Existing 0.6 cards with no date remain due without a read-time migration write; SQLite schema 1 and backup manifest v2 remain unchanged.
- Kept all-card access, answer-hidden recall, editing, source return, offline/Python-free behavior, and exact document anchors. Adaptive SRS, notifications, streaks, cross-PDF queues, and a global study dashboard remain out of scope.

## 0.6.0 — 2026-08-31

- Added Source-Anchored Recall: manual, editable cards from a PDF selection or an anchored AI answer; answers stay hidden until requested and always return to the original PDF page/rect.
- Added minimal local review state (`again` / `remembered`, count, and last review time) without SM-2/FSRS scheduling, notifications, gamification, or a new database.
- Stored cards as optional `study.cards` data in the existing v1 annotation sidecar. Existing sidecars, highlights, sessions, backup manifest v2, and SQLite schema 1 remain compatible.

## 0.5.0 — 2026-08-31

- Added the local-first PDF study loop: compact text-selection actions, semantic highlight meanings, unresolved/resolved study state, and a filtered review list while retaining legacy native PDF highlight types.
- Added durable PDF chat source contexts, selection/page source chips that return to the Reader, and small PDF markers for completed anchored AI conversations.
- Added portable page-relative reading resume in paper metadata, preserving the older localStorage page fallback and avoiding FTS rebuilds for reading-position updates.
- Preserved `.annot` sidecar, legacy session, SQLite schema 1, and backup manifest v2 compatibility. AI and PyMuPDF remain optional; sidecar study state works without either.

## Large-PDF indexing (working tree)

- Replaced synchronous in-memory research indexing with a single-flight background job that reports real PDF page progress and permits cancellation while pages are being extracted.
- Streamed PyMuPDF page JSONL into disposable OS-temp NDJSON staging, re-verified the document path/stat/SHA-256 before commit, and atomically replaced chunks plus FTS so cancellation, source changes, and failures retain the prior index.
- Added clear restart recovery messaging, a commit-time cancellation boundary, idempotent same-document starts, and guarded automatic-title updates that cannot overwrite a user's later edit.
- Prefer the current `pymupdf` import in the extractor so the deprecated `fitz` compatibility warning cannot corrupt the stdout-only JSONL protocol, and prefer a concrete installed Python before Windows Store aliases; retained an older-PyMuPDF fallback and added an opt-in real-PDF integration test.

## 0.4.4 — 2026-08-02

- Added a shared `?` help button and `F1` shortcut with screen-specific tips, a full usage guide, and troubleshooting guidance.
- Added a device-local recursive knowledge memo folder scan. New small UTF-8 text files enter the inbox without changing their originals; duplicate content remains deduplicated.
- Added local long-note split previews for manual and folder imports without an extra AI call or knowledge-store migration.
- Added current-wiki Markdown export with `INDEX.md`, safe Windows filenames, atomic publication, and import-folder loop prevention.
- Added coverage for folder scanning, unchanged-file fingerprints, long-note splitting, export safety, and the existing knowledge invariants.

## Windows-only product direction (working tree)

- Declared Windows 10/11 x64 as PageDock's only supported platform.
- Retired the experimental Apple Silicon build, test, packaging, signing, and distribution plans. Historical Mac code and artifacts are unsupported and must not be distributed.

## macOS Apple Silicon port (working tree)

> Historical, superseded by the Windows-only product direction above. These artifacts are not supported or distributed.

- Added unsigned arm64 DMG/ZIP packaging and a private GitHub Actions friend-test workflow without changing the public release channel.
- Added macOS-native menus with the standard Close Window command, Dock window restoration, ICNS generation, Finder-safe Codex path detection, and ChatGPT OAuth setup guidance.
- Added a PageDock-managed Python virtual environment for PyMuPDF, macOS Keychain protection for optional research credentials, and platform-neutral application-data paths.

## Knowledge MVP (working tree)

- Added an experimental personal knowledge area with a loose-note inbox, local candidate selection, Codex-generated topic/update/conflict proposals, explicit approval, source provenance, and a revisioned Markdown wiki.
- Hardened the knowledge prototype with ChatGPT-OAuth-only server enforcement, multi-file capture and duplicate detection, bounded AI context, editable line diffs, stale-revision rejection, a non-destructive conflict queue, and restorable revision history.
- Added immediate Codex cancellation, a 285-second per-note timeout, first-error batch stopping with no automatic retries, verified byte-identical v1 rollback backups, persistent context-truncation warnings, collapsed long-document diffs, and Markdown result previews.
- Added local draft recovery, next-ten processing, demand-driven non-destructive OAuth status, bounded review/topic rendering, lazy Diff calculation, direct user wiki revisions, recoverable revision trash, conflict resolution notes, storage-size visibility, Korean user documentation, and Korean/English-only Electron locale packaging.

## 0.4.3 — 2026-07-31

- Incremented the application and Windows installer version so recipients can distinguish this build from the earlier 0.4.1 package.
- Removed duplicated Next/React/PDF production dependencies from the Electron shell package.
- Reduced the Windows installer from about 193 MB to 101.8 MB and the unpacked application from over 800 MB to 331.5 MB; Electron now packages only Korean and English locale resources.
- Unified the library, research, and settings headers and visual hierarchy; renamed the user-facing `기술 조사` area to `리서치`.
- Added explicit recovery approval when a PDF is replaced outside PageDock and completed DB/metadata/session/highlight rollback for failed internal rename or move operations.
- Added a Python-free fallback for backups up to 512MB, plus a metadata safety snapshot before every restore.
- Improved first-use and friend usability with visible PDF-add actions, optional PDF-tool setup, native library-folder selection, masked account identifiers, and a responsive research layout.
- Completed practical research gaps: persistent `전체 자료`, configured-only provider choices, Unpaywall DOI lookup, manual patent-number entry, project edit/delete, profile terminology editing, and FTS over claims and personal notes/tags.

## 0.4.0

- Added project-based `기술 조사`, local FTS5 search, editable analysis profiles, paper/patent metadata, and evidence-linked on-demand Codex reports.
- Added stable `documentId`/SHA-256 identity, safe rename, external move recovery, and ambiguity confirmation.
- Added Crossref, Unpaywall, optional OpenAlex, and patent-search/manual-import workflows.
- Added device-local encrypted optional provider credentials.
- Upgraded portable backups to normalized v2 research data while retaining v1 import and legacy `.annot` compatibility.
- Added repository direction, architecture, data-model, roadmap, state, and ADR documentation with release checks.
- Fixed standalone packaging so old installers are not recursively embedded; packaged startup now includes the Next 16 route runtimes omitted by standalone tracing.

## 0.3.0

- Added PageDock branding, desktop installer/update flow, managed library, backups/trash, selectable Codex model/reasoning, and PDF interaction fixes.
