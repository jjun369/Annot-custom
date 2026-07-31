# Roadmap

## Implemented — 0.4

- Stable UUID/SHA-256 document identity and legacy JSON compatibility.
- Project-based research UI, SQLite/FTS5, profiles, patent metadata, lawful paper search/import, on-demand Codex analysis, evidence navigation.
- Shared PageDock header/navigation and consistent 240px library/research sidebars, controls, cards, empty states, and settings hierarchy.
- Filename suggestion, confirmed rename, external move/hash recovery and conflict confirmation.
- Device-local encrypted optional source credentials.
- Normalized backup v2 with v1 import compatibility.
- Repository handoff documents and release document checks.
- Experimental knowledge inbox with immutable source notes, review-gated Codex topic proposals, conflict surfacing, and a revisioned personal wiki.
- Knowledge safety hardening with cancellable/time-bounded single-flight processing, first-error batch stop, verified v1 rollback copies, visible bounded-context warnings, collapsed long diffs, and Markdown result preview.
- Lightweight knowledge operations with local draft recovery, next-ten processing, demand-driven OAuth status, direct user revisions, recoverable revision trash, conflict resolution notes, bounded list rendering, and storage-size visibility.
- Apple Silicon macOS port source with arm64 DMG/ZIP packaging, native menu/Dock lifecycle, platform-aware Codex and PDF setup, macOS Keychain protection, and a private test-artifact workflow.

## Planned

- Extend KIPRIS Plus citation and EPO OPS family/legal-event normalization.
- Improve PDF metadata extraction and background indexing progress/cancellation.
- Add selected-page figure analysis UI and richer claim/paragraph anchors.
- Code signing and a hardened public installer release workflow.
- Validate the unsigned macOS artifact on a real M-series Mac, then add Developer ID signing, notarization, and signed Mac updates if friend testing succeeds.
- Improve knowledge candidate retrieval, add topic merge/split and Markdown export, and evaluate persisted queue counters only if interrupted real-world batches prove the need.

## Deferred

- WebView2 migration/installer size reduction.
- Embedding search, weekly radar, large-scale crawling, technology maps, inventor networks, automatic Samsung terminology dictionary.
- Cloud synchronization, shared projects, internal company models/data.
- Local LLM and embedding-model integration.

## Excluded

- Paywall bypasses, Sci-Hub/mirror discovery, publisher credential collection.
- Legal freedom-to-operate judgments.
