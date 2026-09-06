# ADR 0012: Additive PDF study-loop persistence

Status: Accepted for PageDock 0.5.0.

PageDock adds Reader study state without changing SQLite schema 1 or portable backup manifest v2. Existing `.annot` sidecars, paper metadata JSON, and session JSON are the persistence substrate.

`Highlight.type` remains the native/legacy representation (`important | unknown`). Optional `studyKind`, `resolvedAt`, `createdAt`, and `updatedAt` are sidecar metadata. Old highlights infer a semantic kind at read time. Native annotations never need to understand the semantic fields, and sidecar fields are explicitly merged back after native annotation reads.

Anchored AI turns use optional `ChatMessage.sourceContext` and `replyToMessageId`. Source context stores only bounded selection data and source locators; it never replaces the session PDF identity, duplicates full PDF text, or writes into Knowledge. Provider prompts treat PDF text as untrusted source material.

Reading position is optional `PaperMetadata.readingPosition`. The existing localStorage last-page key remains a compatibility fallback for at least this release. Metadata-only position updates do not trigger FTS refresh. Existing metadata move, trash/restore, and portable backup paths retain the optional field.

This decision deliberately excludes a Study Loop SQLite table, a sidecar-version bump, a backup-manifest bump, automatic AI, automatic resolution, cloud synchronization, and migrations that rewrite old sessions or highlights.
