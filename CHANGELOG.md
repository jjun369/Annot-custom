# Changelog

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
