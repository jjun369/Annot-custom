# ADR 0011: Ephemeral large-PDF indexing jobs

Status: Accepted for the PageDock 0.4.4 Windows-only working tree.

Large PDF indexing runs as one process-local job at a time. Starting the same document again returns the existing job; attempting another document while one is active returns a visible busy error. Jobs are not stored in SQLite, backups, or the workspace and do not resume after a server/app restart. Terminal snapshots remain in memory only for 30 minutes.

PyMuPDF emits a JSONL protocol with a page total, ordered page text events, and a final completion event. Node validates the protocol, bounds event/stderr/staging size, stops an idle extractor after 60 seconds or a whole extraction after 30 minutes, and writes split chunks immediately to disposable NDJSON under the user's operating-system temporary directory. This staging directory is removed on success, cancellation, failure, expiry cleanup, and process initialization. It is not a secondary index or recoverable data.

At start, PageDock records the document's current relative path, size, mtime, and registered SHA-256. After extraction completes, it reads the document again, verifies the path/stat values, computes the SHA-256 once, and checks the stat again. Only then does one SQLite transaction replace chunks, indexed time, and FTS. This preserves the old searchable index if the source changed, extraction failed, or the user cancelled.

Cancellation is accepted only in `starting` and `extracting`. Once the final cancellation check passes, the job enters `committing` and cancellation returns a conflict: atomicity takes precedence over a late cancellation request. Automatic title inference is a separate best-effort conditional update and never overwrites a title that the user changed while indexing.

This decision intentionally does not add a persistent queue, checkpoints/resume, multi-document concurrency, automatic retries/reindexing, a database schema migration, backup state, or a fake time-based percentage.
