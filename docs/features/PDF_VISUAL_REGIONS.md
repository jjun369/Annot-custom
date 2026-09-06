# PDF visual regions

Status: Implemented in the PageDock 0.9 working tree.

## Purpose

`영역 기록` lets a reader retain a paper figure, table, equation, process condition, or another visual detail together with a short personal memo. It is a durable link back to the original PDF, not an image scrapbook.

## Reader flow

1. Choose `영역 기록` in the Reader toolbar.
2. Drag one rectangle on one rendered PDF page.
3. Choose `그림`, `표`, `수식`, `공정 조건`, or `직접 지정`, then optionally write a memo.
4. Save. A restrained outline appears on the original page and the `읽기 기록` panel lists the record.
5. Select a list item to return to the exact page and region. The item can be edited or deleted; deletion asks for confirmation.

The selection mode is explicit so ordinary text selection, highlighting, AI questions, scrolling, and existing Reader shortcuts retain their normal behaviour. Escape cancels a pending draw or editor. Saved records are keyboard reachable from the toolbar and record list.

## Storage and portability

Records are optional top-level `visualRegions` in the existing per-document `.annot` sidecar. A record stores only stable `documentId`, one-based page number, normalized page-relative rectangle, kind, user memo, and timestamps. The current PDF remains the visual source of truth.

No persistent crop/thumbnail, image path, OCR text, caption extraction, AI explanation, render DPI, viewport pixels, or mutable `pdfPath` is stored. Existing sidecar locks and atomic writes serialize edits. Empty or old sidecars load as no visual records; malformed individual records are ignored. The existing document-id sidecar path, rename/move handling, and portable backup preserve valid records without a new database or manifest version.

## Offline boundaries

Drawing, recording, editing, deleting, overlays, source return, rename/move, and backup work without Python, an AI provider, or network access. PyMuPDF is not called for this feature.

## Deliberate P0 exclusions

Persistent crops or thumbnails, OCR, caption/table extraction, multimodal AI, automatic figure detection or classification, visual semantic search, a global gallery/Vault, new Knowledge or Research entities, freehand/multi-page regions, table-to-CSV, equation-to-LaTeX, and cloud sharing are excluded. They may be reconsidered only after this small source-anchor loop proves useful in real reading.
