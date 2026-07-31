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

If a file at the same relative path has a different SHA-256, the stored hash and `documentId` remain unchanged and a `content-changed` conflict is created. Accepting that conflict explicitly promotes the current file to a new version while preserving the document relationships. Merely dismissing the warning is not allowed. Internal rename/move compensation restores the file, metadata, sessions, database path, and sidecar content when a later step fails.

FTS content includes display title, abstract, indexed PDF chunks, patent claims, document tags, AI/personal tags, and the local paper note. Updating paper metadata refreshes the associated document search index.

Migration rules:

- Existing PDFs and `.annot` JSON are indexed idempotently.
- Existing sidecars are read by the legacy path hash, then copied to the `documentId` filename.
- Existing sessions continue to read without `documentId`; saving or opening a registered PDF adds it.
- Never remove the fallback reader in the same release that introduces a new format.

## Personal knowledge store

The experimental knowledge area uses `.annot/knowledge-store.json` format version 2, separately from the research SQLite schema. The reader normalizes the earlier format version 1:

- `KnowledgeNote` preserves the exact captured text, source label, content hash, and processing state.
- `KnowledgeReview` records a Codex proposal (`create`, `update`, or `conflict`), its base revision, rationale, extracted source claims, editable proposed Markdown, and acceptance state.
- `KnowledgeTopic` is the current readable wiki projection with monotonic revision history and all contributing source-note IDs.
- `KnowledgeTopicRevision` may record a review, a restore source, or `editedBy: "user"` with an optional change note.
- `KnowledgeConflict` is an unresolved claim set attached to a topic without changing the topic's current body.
- `KnowledgeRevisionTrashItem` stores one explicitly removed historical revision in `.annot/knowledge-revision-trash.json`; it never accepts the current revision.

Only accepting a current create/update review mutates or creates a topic. A stale update is rejected, restoring history creates a new revision, and accepting a conflict only creates a conflict record. Source notes and resolved proposals are retained. The existing portable backup includes the knowledge JSON as a normal library file.
- The first mutation of a v1 knowledge store creates a byte-identical `.annot/knowledge-store.v1-backup-<hash>.json` rollback copy before replacing the active file. Reads alone never migrate on disk.
- Reviews retain `contextWarnings` when candidate topic excerpts were truncated or omitted, so that limitation remains visible after restart.
- Revision trash moves and restores use loss-averse two-file ordering: a crash may leave a duplicate, never an unprotected missing revision.
- Backup restore remaps paths, deduplicates documents by SHA-256 then DOI, and remaps project/report foreign keys.
