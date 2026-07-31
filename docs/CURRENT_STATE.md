# Current state

- App version: 0.4.1
- Status: PageDock 0.4.1 implementation complete in working tree
- Last verified commit: PageDock 0.4.1 knowledge and research revision on `main`; use Git history for the exact SHA
- Build status: documentation, lint, TypeScript, 21 tests, production build, Electron packaging, and packaged `--smoke-test` passed
- Database: schema 1 (`.annot/pagedock.sqlite`, Node 24 `node:sqlite`, FTS5)
- Backup: v2 export/import; v1 import retained
- Knowledge MVP: draft-safe multi-file immutable inbox, next-ten/single-flight ChatGPT-OAuth-only proposals, non-destructive authentication errors, cancellation/timeout and first-error stop, lazy bounded review rendering, direct user wiki revisions, conflict resolution notes, recoverable revision trash, storage-size visibility, verified v1 rollback backup, stale-update protection, and restorable topic history (`.annot/knowledge-store.json` format 2 with v1 normalization)
- Windows artifact: `PageDock-Setup-0.4.1.exe` 101.8 MB; unpacked 331.5 MB; Electron locales limited to `ko` and `en-US`
- macOS port source: Apple Silicon arm64 DMG/ZIP configuration, native menu/Dock lifecycle, Codex OAuth detection, managed PyMuPDF environment, macOS Keychain credentials, and private CI workflow implemented; macOS artifact verification pending CI and a real M-series Mac

Known issues:

- KIPRIS Plus and EPO OPS support authenticated search; richer citation, family, and legal-event normalization remains planned. Manual number/URL/PDF and external provider links work without keys.
- Windows installer is not code-signed, so SmartScreen may warn.
- The private macOS friend-test build is unsigned and not notarized; Gatekeeper override and real-device validation are required before use.
- WebView2 migration is deferred.

Verification completed: document reconnection/duplicate detection, multi-project links, Korean/English FTS, normalized backup v2 contents including revision trash, documentation/version checks, lint, TypeScript, production build, packaged Windows startup, and browser rendering of the knowledge empty state.

Further manual soak testing recommended before public release: real 500-page PDF indexing, real v0.3/v1 archives from another PC, and live user-owned KIPRIS/EPO quota behavior.

Knowledge follow-up testing recommended: Korean technical-note sets with near-duplicates, version-dependent contradictions, real long topic pages, live interrupted Codex runs, and repeated accept/reject cycles.
