# ADR 0018: PDF visual records are durable region anchors, not persisted crops

Status: Accepted in the PageDock 0.9 working tree.

## Context

Technical readers often need to revisit a chart, table, equation, or process-condition diagram with their own short interpretation. Saving a screenshot is tempting, but creates a separate binary whose freshness, backup, path, and identity can drift from the original PDF.

PageDock already has stable `Document.id`, document-id sidecars, atomic sidecar mutations, exact source navigation, portable backups, and a Reader-first local workflow. The visual-record feature must extend this substrate without making a second image library.

## Decision

1. A visual record is one `documentId`, page number, normalized page-relative rectangle, allowed kind, user memo, and timestamps in optional top-level `visualRegions` of the existing v1 `.annot` sidecar.
2. The rectangle is strictly finite, non-zero, and wholly within `[0,1]` page geometry. Malformed stored records are ignored rather than broadly clamped.
3. `pdfPath` is never persisted in the record. The current document path is resolved through the existing stable identity contract.
4. Persistent crop images, thumbnails, OCR/caption text, AI interpretation, render scale, viewport coordinates, and inferred labels are prohibited. Any later thumbnail may only be disposable cache and may not affect restore or source return.
5. Reader UI uses an explicit rectangle-selection mode, compact kind/memo editor, subtle overlay, and existing reading-record panel. It does not create a global Visual Vault.
6. SQLite schema 1, sidecar version 1, backup manifest v2, native-PDF annotation behaviour, AI, and Python dependencies remain unchanged.

## Consequences

The reader can always return to the original visual evidence after restart, rename/move, or backup restore without treating an old crop as independent truth. The initial scope deliberately stays small and offline-first. OCR, multimodal questions, extraction, galleries, and cross-document visual search remain future decisions rather than hidden storage commitments.

## Verification

Pure tests cover strict geometry, kind/memo normalization, Korean text round trips, stable source ordering, and no-path/no-thumbnail fields. Sidecar tests cover atomic additive coexistence with highlights/cards, unknown top-level field retention, document rename, and backup inclusion while the outer sidecar remains v1.
