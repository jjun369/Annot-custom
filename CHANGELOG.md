# Changelog

## macOS Apple Silicon port (working tree)

- Added unsigned arm64 DMG/ZIP packaging and a private GitHub Actions friend-test workflow without changing the public release channel.
- Added macOS-native menus, Dock window restoration, ICNS generation, Finder-safe Codex path detection, and ChatGPT OAuth setup guidance.
- Added a PageDock-managed Python virtual environment for PyMuPDF, macOS Keychain protection for optional research credentials, and platform-neutral application-data paths.

## Knowledge MVP (working tree)

- Added an experimental personal knowledge area with a loose-note inbox, local candidate selection, Codex-generated topic/update/conflict proposals, explicit approval, source provenance, and a revisioned Markdown wiki.
- Hardened the knowledge prototype with ChatGPT-OAuth-only server enforcement, multi-file capture and duplicate detection, bounded AI context, editable line diffs, stale-revision rejection, a non-destructive conflict queue, and restorable revision history.
- Added immediate Codex cancellation, a 285-second per-note timeout, first-error batch stopping with no automatic retries, verified byte-identical v1 rollback backups, persistent context-truncation warnings, collapsed long-document diffs, and Markdown result previews.
- Added local draft recovery, next-ten processing, demand-driven non-destructive OAuth status, bounded review/topic rendering, lazy Diff calculation, direct user wiki revisions, recoverable revision trash, conflict resolution notes, storage-size visibility, Korean user documentation, and Korean/English-only Electron locale packaging.

## 0.4.1 — Unreleased

- Removed duplicated Next/React/PDF production dependencies from the Electron shell package.
- Reduced the Windows installer from about 193 MB to 101.8 MB and the unpacked application from over 800 MB to 331.5 MB; Electron now packages only Korean and English locale resources.
- Unified the library, research, and settings headers and visual hierarchy; renamed the user-facing `기술 조사` area to `리서치`.

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
