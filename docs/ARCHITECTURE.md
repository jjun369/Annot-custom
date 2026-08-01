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

The sandboxed Electron renderer exposes one narrow preload capability for choosing a library directory with the native operating-system dialog. It does not expose arbitrary filesystem, shell, credential, or process access to the web UI.

PDF ingestion computes SHA-256, creates or finds a `documentId`, and keeps the current relative path plus aliases. Workspace scans repair a missing path when exactly one matching hash exists. Ambiguous matches become visible conflicts. Replacing the contents at an existing path creates a blocking `content-changed` conflict; PageDock retains the previous identity hash until the user explicitly accepts the current file as a new version.

Codex authentication and model selection follow the official CLI. `자동` does not pin a model version. Analysis sends only the selected document chunks and selected page images, validates returned evidence against real chunks/pages, and stores the structured report locally.

Source credentials are stored outside the library in the user's PageDock application-data directory. Windows DPAPI protects secrets. They are excluded from backup and logs. Historical macOS Keychain compatibility code is not part of the supported release contract and may be removed during later maintenance.

PageDock packages and releases only Windows 10/11 x64 through NSIS. Build verification, smoke testing, code signing, updates, and installer-size work target Windows only. The abandoned experimental Apple Silicon port is retained only as repository history; no Mac artifact is supported or distributed.

Backups use a v2 manifest. PDFs and legacy JSON are ordinary archive files; SQLite is exported to normalized research JSON and merged during restore. v1 import remains supported. Restore first creates a metadata-only safety snapshot. Python performs streaming extraction when available; archives up to 512MB also have an in-process fallback so a fresh friend PC is not blocked before PDF-tool setup.

Deferred: WebView2 shell, embeddings/vector database, cloud sync, and company AI adapters.

## Personal knowledge flow

The knowledge area stores its active versioned JSON at `.annot/knowledge-store.json` and recoverable removed history at `.annot/knowledge-revision-trash.json`. Capture is local and immutable. A deterministic term matcher selects bounded, visibly marked head/tail excerpts from candidate topics. Codex returns schema-constrained proposals in a cancellable, time-bounded read-only process, and application code applies only proposals explicitly accepted by the user. Direct user edits also create revisions without a model call. A v1 source is preserved as a verified content-addressed rollback file before the first mutation; active and trash JSON files use validated temporary writes and atomic rename.

The 0.4.4 knowledge capture extension keeps its folder path and bounded file fingerprint ledger in device-local `%APPDATA%\\PageDock\\knowledge-import.json`. Folder scans are explicit on knowledge-page entry or refresh, recurse through ordinary subdirectories, skip symlinks and known runtime/export directories, and read only UTF-8 text files. Long-file segmentation is a deterministic local operation before normal inbox capture. Markdown export writes only the current topic projection to a timestamped destination through a temporary directory and never writes inside the configured import folder.

The shared `AppHeader` opens static screen-aware help content by button or `F1`; it does not load external documentation at runtime.
