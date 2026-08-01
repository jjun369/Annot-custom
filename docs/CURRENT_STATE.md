# Current state

- App version: 0.4.4
- Status: PageDock 0.4.4 Windows-only practical knowledge improvements implemented in the working tree
- Release baseline: PageDock 0.4.4; final Windows verification and packaging completed before commit
- Build status: documentation, lint, TypeScript, 35 tests, production build, Windows Electron packaging, packaged preload inspection, and isolated `--smoke-test` passed
- Database: schema 1 (`.annot/pagedock.sqlite`, Node 24 `node:sqlite`, FTS5)
- Backup: v2 export/import; v1 import retained
- Knowledge MVP: draft-safe multi-file immutable inbox, device-local recursive memo-folder capture, local long-note split previews, next-ten/single-flight ChatGPT-OAuth-only proposals, non-destructive authentication errors, cancellation/timeout and first-error stop, lazy bounded review rendering, direct user wiki revisions, conflict resolution notes, recoverable revision trash, storage-size visibility, verified v1 rollback backup, stale-update protection, restorable topic history, and current-wiki Markdown export (`.annot/knowledge-store.json` format 2 with v1 normalization)
- Windows artifact: refreshed `PageDock-Setup-0.4.4.exe` 101.9 MB; unpacked 331.9 MB; packaged product version `0.4.4.0`; SHA-256 `DCDDF10B1B3F328C0CD845A0B185BA4EF79372A949442F73B791927E03DC297B`
- Supported platform: Windows 10/11 x64 only. The former experimental Apple Silicon port and its old CI artifacts are unsupported historical work and must not be rebuilt or distributed.

Known issues:

- KIPRIS Plus and EPO OPS support authenticated search; richer citation, family, and legal-event normalization remains planned. Manual number/URL/PDF and external provider links work without keys.
- Codex-assisted query expansion/reranking, robust author/year/patent-number extraction, and cancellable background indexing remain planned. Exact local FTS remains the offline fallback.
- Python-free restore currently holds archives up to 512MB in memory; larger archives require the prepared PDF/Python tool until a streaming Node extractor is added.
- Windows installer is not code-signed, so SmartScreen may warn.
- Next.js Turbopack still reports the known dynamic filesystem tracing warning for the workspace search route; the production build succeeds, but the trace should be narrowed in a later maintenance pass.
- WebView2 migration is deferred.

Current working-tree verification covers explicit same-path content replacement approval, multi-project links, Korean/English/claims/personal-note FTS, Windows-safe filename suggestions, normalized backup v2 contents including revision trash, Python-free small-backup restore with a safety snapshot, navigation/preload policy, documentation/version checks, lint, TypeScript, 29 tests, production build, refreshed Windows packaging, preload inclusion, and isolated packaged startup.

Further manual soak testing recommended before public release: real 500-page PDF indexing, real v0.3/v1 archives from another PC, and live user-owned KIPRIS/EPO quota behavior.

Knowledge follow-up testing recommended: Korean technical-note sets with near-duplicates, version-dependent contradictions, real long topic pages, live interrupted Codex runs, and repeated accept/reject cycles.
