# ADR 0006: Review-gated Codex knowledge inbox

Status: Accepted

PageDock adds an experimental personal knowledge area without introducing a direct model API or API-key workflow. It reuses the supported Codex CLI ChatGPT OAuth sign-in on the device and rejects API-key authentication in the server processing route. Raw notes are stored unchanged in `.annot/knowledge-store.json`; only locally selected topic candidates are included in a structured Codex request.

Codex produces proposals rather than editing storage directly. A proposal is classified as a new topic, an update, or an unresolved conflict. The user must accept a proposal before the readable wiki changes. Updates are tied to their base revision, rejected proposals and source notes remain available, topic history is restorable, and accepted conflicts enter a separate queue without modifying the current wiki body.

The first revision deliberately uses deterministic local term matching instead of embeddings. This keeps the no-direct-API constraint and bounds model context. Candidate retrieval can later be replaced without changing the capture, proposal, or approval contracts.

The version-2 knowledge store reads and normalizes the original version-1 shape without rewriting it on read. Before the first v2 mutation, PageDock preserves and verifies the exact v1 bytes in a content-addressed rollback file. Both the active store and rollback file are ordinary portable files and are therefore included by the existing backup-v2 file collector. No research SQLite schema or normalized research export changes are required.

Codex processing is single-flight. The application does not automatically retry model work, stops a batch at the first error, supports aborting the active CLI process, and applies a 285-second execution timeout. Bounded candidate excerpts carry explicit truncation markers, and the resulting review keeps a user-visible warning so approval is informed rather than silent.
