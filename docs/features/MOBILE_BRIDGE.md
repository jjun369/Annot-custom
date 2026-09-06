# Mobile bridge

Status: Implemented in the PageDock 0.9 working tree.

## Purpose

The Mobile Bridge gives a commuter-friendly read-only view of deliberately selected PageDock study records. It is not cloud synchronization: the Windows Library, source PDFs, sidecars, sessions, Research DB, and Knowledge store remain local and authoritative.

## Setup and use

1. In a PDF Reader's `더보기` menu, choose `모바일 보관함에 추가` for only the documents you want on another device.
2. In Settings, choose a separate synced folder such as a Google Drive desktop folder. PageDock creates `Mobile`, reserved `Inbox`, `Backups/Manual`, and `Backups/Auto`.
3. Choose `지금 모바일 사본 발행` when you want a fresh mobile snapshot. `변경 후 자동 발행` is **off by default**. If you explicitly turn it on, shelf-related highlights, notes, cards, visual records, and source-anchored completed AI answers coalesce after 90 seconds of inactivity; successful automatic publishes are also limited to one per ten minutes.
4. Open `Mobile/PageDock-Mobile.pdf` in the Drive app. It contains selectable text, study state, labelled user notes and AI explanations, source pages, and embedded visual-record images.

The first page groups unresolved Reader records. Each following document keeps original source text, user memo, AI explanation, recall cards, visual records, and only Knowledge topics that have explicit anchors to that document. Publication year is shown when known; PageDock does not invent a date or treat age as a truth score.

## Conflict and backup behaviour

`manifest.json` is intentionally tiny and verifies the generated PDF. If a phone editor or another program changes the canonical mobile PDF, PageDock stops automatic overwrite. Settings offers `수정본 보존 후 새로 만들기`, which copies the modified PDF and receipt into `Mobile/Conflicts` before replacing the canonical snapshot. PageDock never imports those edits into the Library.

Daily automatic backups exclude original PDFs and retain the latest three successful local ZIPs. Once a local ZIP is validated, the identical file is copied to `Backups/Auto`; the two locations retain three snapshots independently. A manual bridge backup includes PDFs and is never pruned automatically. A Drive/OneDrive copy failure never invalidates a successful local automatic backup.

PageDock only reports that it saved to the linked folder. It does not know whether a sync provider has uploaded a file to its remote service yet.

## Save, publish, and backup are different

- **Original save** writes the actual study record to the Windows PageDock Library. It never waits for the mobile bridge.
- **Mobile snapshot publish** rebuilds the read-only derived PDF. It is optional, does not import phone edits, and is not a backup.
- **Full backup** creates a recoverable ZIP of PageDock source data. Manual backups are retained; automatic backups retain the newest three files.

When automatic publishing is disabled, relevant shelf changes are remembered as `새 변경 있음 · 수동 발행 필요`. Closing the app never forces a large PDF render. When enabled, the pending state is retained, but PageDock only retries a normal I/O failure once after five minutes; external modifications or deletion of a previously issued mobile pair stop automatic overwrite until the user takes an explicit action.

## Deliberate limits

There is no provider login, Drive API, Inbox import, mobile note merge, source-PDF copy, full-library auto-selection, hidden background upload outside the shelf, Markdown/assets mobile package, permanent crop/thumbnail cache, OCR, encryption layer, or remote deletion promise. If a source visual cannot be rendered for an export, the PDF identifies the failed record and asks the reader to return to Windows PageDock rather than substituting a blank or guessed image.
