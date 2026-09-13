# ADR 0027: Visual Knowledge assets remain deliberate, local, and content-addressed

Status: Accepted

Date: 2026-09-14

## Context

Circuit diagrams, instrument screenshots, and a photographed whiteboard can be
more useful than a text-only memo when a reader returns to a technical question
weeks later. They also differ from Reader visual-region records: a PDF region is
only a durable pointer back into an existing source PDF, while a user-selected
image can itself be the personal source material worth retaining.

Embedding image bytes into `knowledge-store.json`, turning every PDF region into
a permanent crop, or auto-sending images to a remote model would make ordinary
capture expensive, blur source boundaries, and risk retaining more than the
reader intended.

## Decision

1. A Knowledge inbox note may deliberately reference up to four user-selected
   PNG/JPEG images. The capture UI currently adds one image per note so the
   description stays attached to one visual thought. SVG, PDF, clipboard
   scraping, OCR, automatic PDF crops, and background image import are not part
   of this feature.
2. Image bytes live only below `.annot/knowledge-assets/<hash-prefix>/<sha256>.<ext>`.
   The note JSON stores a small `{ id, sha256, mime, byteLength }` reference,
   where `id` equals the SHA-256. The same image selected twice is stored once.
3. Capture accepts at most 10 MB and verifies PNG/JPEG file signatures rather
   than trusting an extension or browser MIME claim. It writes a unique partial
   file, syncs and hashes it, then renames it into the content-addressed path.
   Reads recheck byte count, hash, and signature before serving/exporting it.
4. Text-only notes retain their existing content hash. An image note hash also
   includes the attached image hashes, so the same caption with a different
   diagram is not silently deduplicated.
5. Image bytes are never included in a PageDock/Codex or web-provider request
   automatically. If the user explicitly runs remote Knowledge organization,
   only the existing text memo/candidate-topic contract applies; the binary
   image remains local and no vision/OCR interpretation is invented.
6. Existing portable backups already collect ordinary `.annot` files, so these
   assets travel in the same v2 archive without a new manifest or SQLite schema.
   A selected image memo is rendered into the existing read-only Mobile Bridge
   PDF; unselected notes are not copied there. A missing/corrupt image produces
   an honest return-to-Windows notice rather than a substitute image.
7. Assets are loss-averse. An interrupted upload may leave an unreferenced
   content-addressed file; PageDock must not silently garbage-collect it. Any
   future explicit cleanup requires a separate inspection/confirmation design.

## Consequences

The user gets a compact visual memory alongside a short explanation without
creating a second document store, a live NAS sync protocol, or an AI image
pipeline. The active Library remains local. NAS/portable backups can protect
the image assets because they are normal Library files, while the phone copy
remains a deliberate read-only projection rather than a writable archive.
