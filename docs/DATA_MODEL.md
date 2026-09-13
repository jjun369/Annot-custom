# Data model

Status: Implemented schema version 1, portable backup version 2.

`Document.id` is a UUID `documentId`. A path, filename, and display title may change and are never identity. Local PDFs also have SHA-256; DOI and patent publication/application numbers provide secondary reconnection hints. Sessions, metadata, and highlights retain `pdfPath` only for v0.3/v1 compatibility and also store `documentId`.

Core relationships:

- `Project` many-to-many `Document` through `ProjectDocument`.
- `Document` optionally owns one `PatentMetadata` and many `DocumentChunk` rows.
- `AnalysisProfile` can be built-in or user-created.
- `AnalysisReport` references a document, optional project, and profile.
- `EvidenceAnchor` references both report and document and may locate page, section, claim, or figure.
- `DocumentAlias` remembers previous/duplicate paths; `DocumentConflict` records ambiguous recovery that requires confirmation.

Path rules use library-relative forward-slash paths. Internal rename updates the physical PDF, DB current path/aliases, metadata, sessions, sidecars, and selection as one operation with rollback on failure. External changes are detected during start/refresh/watch scans. An exact single hash match reconnects; multiple matches or changed content must not be guessed.

`ReaderSummary` is a transient Library UI response only: it derives `page` from existing `PaperMetadata.readingPosition`, and unresolved/open-work counts from existing sidecar highlights. It is neither persisted nor an identity-bearing document field.

The Library's `다시 볼 것` link is also transient UI only. It carries a one-shot in-memory PDF path to open the Reader's existing unresolved filter; it creates no queue, timestamp, card, or additional document field.

If a file at the same relative path has a different SHA-256, the stored hash and `documentId` remain unchanged and a `content-changed` conflict is created. Accepting that conflict explicitly promotes the current file to a new version while preserving the document relationships. Merely dismissing the warning is not allowed. Internal rename/move compensation restores the file, metadata, sessions, database path, and sidecar content when a later step fails.

FTS content includes display title, abstract, indexed PDF chunks, patent claims, document tags, AI/personal tags, and the local paper note. Updating paper metadata refreshes the associated document search index.

Migration rules:

- Existing PDFs and `.annot` JSON are indexed idempotently.
- Existing sidecars are read by the legacy path hash, then copied to the `documentId` filename.
- Existing sessions continue to read without `documentId`; saving or opening a registered PDF adds it.
- Never remove the fallback reader in the same release that introduces a new format.

## PDF study loop state

PageDock 0.5/0.6/0.7/0.8/0.9 adds only optional fields to existing portable JSON. It does not change SQLite schema 1 or backup manifest version 2.

- `Highlight.type` remains `important | unknown` for native-PDF and legacy compatibility. Optional `studyKind` is `important | concept | memorize | question | unclear`; `resolvedAt`, `createdAt`, and `updatedAt` live in the annotation sidecar. Old `important` is inferred as `important`; old `unknown` is inferred as unresolved `unclear`.
- A highlight may additionally carry optional `workKind: finding | verify | discuss | try` and `workDoneAt`. The existing `note` remains the work interpretation, conclusion, question, or proposed trial; there is no second task text. `workDoneAt` is valid only for `verify`/`discuss`/`try`, never for `finding`, and is independent from study `resolvedAt`. Absent `workKind` remains an ordinary highlight without a read-time migration.
- A PDF chat `ChatMessage` may carry optional `sourceContext` (`pdf`, `page`, or `selection`) and an assistant reply may carry `replyToMessageId`. Selection text, page, normalized rects, `highlightId`, and `documentId` are persisted; full PDF/page text is not duplicated into session JSON.
- An eligible selection-anchored `ChatMessage` may additionally carry `secondaryPerspectives[]`. The initial optional record is a user-pasted DeepSeek web response: `provider: deepseek`, `transport: web-manual`, `acquisition: user-paste`, source/linked-question message IDs, the exact bounded prompt snapshot and SHA-256, response text, imported time, optional requested time, and `model: null` because a consumer web UI does not provide trustworthy model metadata. Existing primary answers keep the record on the assistant; a direct DeepSeek question keeps it on the pre-saved user anchor with both IDs equal. It stores neither web passwords/cookies/tokens nor a mutable PDF path. Missing records preserve old session behavior; session JSON continues as an ordinary portable-backup input. Re-entry can reconstruct either persisted anchor, and a retry with the same anchor, canonical prompt/hash, and normalized response is idempotent.
- An independent `Session` may use optional `sessionKind: "sidechat"` and lives in the root `.annot/sessions.json` namespace. Its messages retain the existing optional `sourceContext`, plus a relative `sourcePdfPath` navigation hint and optional `sideChatQuestionRequestId`. A side-chat user message may carry additive `sideChatPerspectives[]`: provider id, `user-paste` acquisition, side-chat prompt mode/version snapshot and SHA-256, normalized response, import time, and optional user-entered model label that is always displayed as unverified. It may also carry immutable `sideChatWebRequests[]` snapshots: stable request id, session/question identity, provider, independent/review intent and prompt mode/version, exact prompt/hash, bounded source locator, optional selected assistant answer id/snapshot, prepared time, and explicit copied time. A perspective references one saved request id and is rejected if its pinned contract changes; repeated same-request normalized imports are idempotent while different responses remain additive. The question is the canonical anchor; no fake assistant or duplicated PDF history is created. The three outbound modes are question-only, selected-source-plus-question, and selected-source-plus-question-plus-explicitly-selected-assistant-answer. The source remains bounded to one selection and the stable document id/rects remain authoritative for return. These optional JSON fields are carried by portable backup v2's existing session file; v1 import remains dual-readable, and SQLite schema/backup manifest are unchanged.
- That same canonical sidechat user question may carry one optional `sideChatReflection: { text, updatedAt }` written only by an explicit user save. It is a local “my understanding / still to check” note, not an assistant message or verified conclusion. It is omitted from PageDock and web outbound projections and is not copied to PDF chat, highlights, Knowledge, cards, or resolution state. Reflection writes use the latest-state session mutation lock; empty text removes the optional field. Existing records without it remain unchanged, and the existing backup v2/v1 read paths carry it without changing SQLite or the manifest.
- `PaperMetadata.readingPosition` stores page, page-relative scroll ratio, view mode, and update time. `annot-last-page:<pdfPath>` remains a legacy localStorage fallback for at least this release.
- Native PDF annotations and sidecar records are deduplicated by annotation id, then stable highlight id, then page/text/normalized geometry. Sidecar-only study fields win when native PDF output does not contain them.
- Annotation sidecars may carry optional `study: { version: 1, cards: StudyCard[] }`. A `StudyCard` stores its own immutable existing `ChatSourceContext` snapshot, `origin`, timestamps, and only `reviewCount`/`lastReviewedAt`/`lastResult` plus optional `review.nextReviewDate` review state. Missing `kind` retains the historic editable basic `front`/`back` card. A 0.8 manual Cloze writes `kind: "cloze"` plus `clozeText`, `clozeStart`, and exclusive `clozeEnd`; the exact invariant is `sourceContext.text.slice(clozeStart, clozeEnd) === clozeText`. Its front/back are derived from that immutable source, so only the hidden range may be edited. `nextReviewDate` is a local date-only `YYYY-MM-DD`, never a timestamp; new cards use today, `again` uses tomorrow, and `remembered` uses three calendar days later. Missing dates on old sidecars are treated as due without a read-time write. Cards store no filesystem path, event history, scheduler service, or separate study locator.
- Annotation sidecars may additionally carry optional top-level `visualRegions: VisualRegion[]`. Each record is only `id`, `documentId`, one-based `page`, one normalized `{x,y,width,height}` rectangle, `kind` (`figure | table | equation | process_condition | custom`), a user-authored `memo`, and timestamps. It stores no `pdfPath`, crop, thumbnail, OCR/caption text, AI interpretation, render scale, or viewport coordinates. Invalid rectangles are ignored on load rather than clamped into a different paper region; the existing atomic sidecar writer preserves unknown top-level additive fields.

## Personal knowledge store

The experimental knowledge area uses `.annot/knowledge-store.json` format version 2, separately from the research SQLite schema. The reader normalizes the earlier format version 1:

- `KnowledgeNote` preserves the exact captured text, source label, content hash, and processing state. Optional additive `provenance` has one origin class (`literature_claim`, `work_observation`, `personal_hypothesis`, or `ai_inference`), an optional origin date, and bounded AI answer metadata only for `ai_inference`. Optional `sourceAnchors` reuse existing bounded `ChatSourceContext` records; no path becomes permanent identity. Optional `attachments[]` contains at most four `{ id, sha256, mime: image/png|image/jpeg, byteLength }` references for explicitly selected visual memo assets. `id` equals `sha256`; text-only hashes remain unchanged, while an image-note hash includes its sorted attachment hashes.
- `KnowledgeReview` records a Codex proposal (`create`, `update`, or `conflict`), its base revision, rationale, extracted source claims, editable proposed Markdown, and acceptance state.
- `KnowledgeTopic` is the current readable wiki projection with monotonic revision history and all contributing source-note IDs. It may retain the originating provenance and an optional user-controlled `trust` attention state: `reviewRequestedAt`, `reviewReason`, and `lastReviewedAt`.
- `KnowledgeTopicRevision` may record a review, a restore source, or `editedBy: "user"` with an optional change note.
- `KnowledgeConflict` is an unresolved claim set attached to a topic without changing the topic's current body.
- `KnowledgeRevisionTrashItem` stores one explicitly removed historical revision in `.annot/knowledge-revision-trash.json`; it never accepts the current revision.

Only accepting a current create/update review mutates or creates a topic. A stale update is rejected, restoring history creates a new revision, and accepting a conflict only creates a conflict record. Source notes and resolved proposals are retained. The existing portable backup includes the knowledge JSON and `.annot/knowledge-assets/<hash-prefix>/<sha256>.<png|jpg>` as normal library files.
- Provenance is not a confidence score and never produces an automatic expiry, stale warning, truth classification, or AI-only promotion. A manual review request and completion deliberately leave the current topic body, `updatedAt`, and revision history unchanged. Existing JSON without these fields loads as `유형 미지정 · 기존 지식` without a read-time rewrite.
- The first mutation of a v1 knowledge store creates a byte-identical `.annot/knowledge-store.v1-backup-<hash>.json` rollback copy before replacing the active file. Reads alone never migrate on disk.
- Reviews retain `contextWarnings` when candidate topic excerpts were truncated or omitted, so that limitation remains visible after restart.
- Revision trash moves and restores use loss-averse two-file ordering: a crash may leave a duplicate, never an unprotected missing revision.
- Image assets are content-addressed local blobs. They are accepted only after PNG/JPEG signature, byte-limit, temporary-file sync, hash, and final-file verification; reads check the same receipt. They are not SQLite data, remote-AI payloads, automatic PDF crops, or a garbage-collected cache. Legacy notes have no `attachments` and continue unchanged.
- Backup restore remaps paths, deduplicates documents by SHA-256 then DOI, and remaps project/report foreign keys.

Knowledge folder settings and file fingerprints are device-local operational state in `%APPDATA%\\PageDock\\knowledge-import.json`. They are intentionally outside `.annot` and portable backups because a selected Windows path may not exist on another PC. The knowledge store remains format version 2; split imports create ordinary immutable `KnowledgeNote` records and Markdown export is a projection of current topics only.

## Mobile bridge operational state

ADR 0025 adds optional `shelfTopicIds` and `shelfNoteIds` to the device-local version-1 settings. Missing arrays normalize to empty without a read-time write. These are explicit export selections, not Knowledge membership or ownership. `MobileBridgeInfo.knowledgeShelf` is a transient summary of selected records and missing IDs; no topic/note body is duplicated into settings or the receipt. Library Knowledge format 2 and portable backup manifest 2 are unchanged.

`%APPDATA%\\PageDock\\mobile-bridge.json` is a device-local version-1 setting. It stores `bridgeRoot`, a de-duplicated Mobile Shelf of stable `documentId` values, the opt-in automatic-publication preference, and small operational state (`mobileExportDirty`, revision/timestamps, last successful automatic export, and a bounded retry marker). It stores no mutable PDF path, copied study content, crop, image path, sync cursor, remote account, or provider token. Missing documents remain visible as missing shelf entries; a rename/move reconnects through the existing document identity.

The external bridge is a derived-output boundary, not an additional PageDock database. `Mobile/PageDock-Mobile.pdf` is paired with a minimal `manifest.json` (`schemaVersion`, `exportId`, `generatedAt`, `artifact`, `sha256`). The manifest must not duplicate document, highlight, rect, session, Knowledge, or image records. Visual crop bytes exist only while generating the PDF and are embedded into that one projection. Existing annotation-sidecar, session, paper-metadata, Knowledge, SQLite schema 1, and portable-backup v2 contracts remain unchanged.

## NAS snapshot replica operational state

ADR 0026 adds `%APPDATA%\\PageDock\\backup-replica.json`, a device-local version-1 operational setting. It contains an optional Windows-accessible target path, opt-in automatic-copy preference, and minimal last-success (`fileName`, byte size, SHA-256, copied time) or failure time. It deliberately contains no NAS credentials, remote account/token, source PDF path, copied study record, database data, remote cursor, or mutable Library path. It is excluded from portable Library backup because it is specific to one Windows device and one mounted folder.

Replica ZIPs are ordinary existing portable-backup v2 files, so their embedded `manifest.json`, file hashes, v1 import compatibility, SQLite normalized-export rules, and restore behavior remain unchanged. The extra NAS directory is a passive copy destination, not a second store or a new schema.
