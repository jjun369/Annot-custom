# ADR 0010: Practical knowledge capture, help, and Markdown export

Status: Accepted for PageDock 0.4.4 Windows-only implementation.

PageDock adds three local-first usability paths around the existing review-gated knowledge inbox:

- A user-selected folder is scanned only when the knowledge screen opens or the user explicitly refreshes it. Supported UTF-8 text files are read without changing the original files. Small new files enter the inbox immediately, while large files wait for a local split preview.
- Long notes are split locally at Markdown heading and paragraph boundaries. Splitting does not call Codex, does not weaken the OAuth-only processing rule, and does not change `.annot/knowledge-store.json` version 2.
- The current wiki projection can be exported to a timestamped folder containing `INDEX.md` and one Markdown file per current topic. Raw notes, historical revisions, and revision trash remain in the normal portable backup instead of the lightweight export.

The folder path and a bounded file fingerprint ledger live in device-local `%APPDATA%\\PageDock\\knowledge-import.json`; they are not portable library data because paths differ between Windows PCs. Folder scans include subdirectories but skip symlinks/junctions, repository/runtime directories, and PageDock export folders. A missing folder remains configured and is reported for recovery rather than silently disconnecting.

The shared header includes a `?` help button and `F1` shortcut. Help is a static, screen-aware dialog with a short current-screen guide, a complete usage overview, and troubleshooting. It opens only by user action and never interrupts capture or AI review.

This revision intentionally does not add a background watcher, tray capture, an extra AI split call, topic merge/split, embeddings, or any automatic wiki approval.
