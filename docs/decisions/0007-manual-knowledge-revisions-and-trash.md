# ADR 0007: Manual knowledge revisions and recoverable history cleanup

Status: Accepted

The user owns the wiki rather than merely reviewing AI output. PageDock therefore permits direct Markdown edits without a model call. A direct edit never overwrites history: it increments the topic revision and records `editedBy: "user"` plus an optional change note.

Historical revision cleanup is explicit and recoverable. The current topic revision cannot be removed. A selected historical revision moves from `.annot/knowledge-store.json` to `.annot/knowledge-revision-trash.json`. The trash copy is atomically written before the active history is changed, so an interrupted move may leave a harmless duplicate but must not lose the revision. Restoring publishes the active copy before removing the trash record for the same reason. Permanent deletion requires a separate explicit user confirmation.

The trash file is an ordinary portable library file and remains included in PageDock backups. Keeping it separate reduces the active snapshot and UI history while preserving recovery until permanent deletion. This does not change knowledge store version 2 or the portable backup format.

Authentication errors do not authorize PageDock to log out Codex. The UI retains the last known state, marks it as needing confirmation, and offers manual status refresh or reconnect. The server continues to enforce ChatGPT OAuth immediately before every AI run. Ordinary knowledge refreshes do not spawn a Codex login-status process.

The revision also adds lightweight operational controls without reducing model quality: local draft preservation, next-ten processing, confirmation for large queues, bounded client rendering, lazy diff calculation, and storage-size visibility. It deliberately keeps medium reasoning, the existing candidate limits, JSON persistence, and full revision snapshots.
