# Architecture

Status: Implemented for PageDock 0.4 unless marked Deferred.

```text
Electron shell
  -> loopback-only Next.js standalone server
     -> React UI (library / research / settings)
     -> legacy .annot JSON sessions, metadata, highlights
     -> node:sqlite FTS5 database (.annot/pagedock.sqlite)
     -> PDF text/image helpers
     -> Codex CLI structured analysis
     -> Crossref / Unpaywall / optional OpenAlex and patent services
```

Electron packages the web server and opens a desktop window. Runtime data lives in PageDock Library, never the installation directory. The local server is loopback-only. Existing JSON remains the compatibility layer while research relationships, chunks, projects, patents, reports, and evidence use SQLite.

PDF ingestion computes SHA-256, creates or finds a `documentId`, and keeps the current relative path plus aliases. Workspace scans repair a missing path when exactly one matching hash exists. Ambiguous matches become visible conflicts.

Codex authentication and model selection follow the official CLI. `자동` does not pin a model version. Analysis sends only the selected document chunks and selected page images, validates returned evidence against real chunks/pages, and stores the structured report locally.

Source credentials are stored outside the library in the user's PageDock application-data directory. Windows DPAPI protects secrets on Windows; macOS stores the corresponding values in Keychain and keeps only non-secret markers in PageDock JSON. They are excluded from backup and logs.

Windows packages use NSIS x64. The first macOS port targets Apple Silicon arm64 with an unsigned DMG and ZIP kept as private CI artifacts. The Mac shell keeps the loopback Next server alive when the last window closes, recreates the window from the Dock, and provides native edit/window menus. Public Mac distribution, automatic updates, Developer ID signing, and Apple notarization remain gated on real-device testing and signing credentials.

Backups use a v2 manifest. PDFs and legacy JSON are ordinary archive files; SQLite is exported to normalized research JSON and merged during restore. v1 import remains supported.

Deferred: WebView2 shell, embeddings/vector database, cloud sync, and company AI adapters.

## Personal knowledge flow

The knowledge area stores its active versioned JSON at `.annot/knowledge-store.json` and recoverable removed history at `.annot/knowledge-revision-trash.json`. Capture is local and immutable. A deterministic term matcher selects bounded, visibly marked head/tail excerpts from candidate topics. Codex returns schema-constrained proposals in a cancellable, time-bounded read-only process, and application code applies only proposals explicitly accepted by the user. Direct user edits also create revisions without a model call. A v1 source is preserved as a verified content-addressed rollback file before the first mutation; active and trash JSON files use validated temporary writes and atomic rename.
