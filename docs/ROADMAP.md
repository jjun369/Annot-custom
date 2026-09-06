# Roadmap

## Implemented — provenance-gated Knowledge promotion (working tree)

- Reader highlights and anchored AI answers can enter the existing Knowledge inbox with explicit source classes, original anchors, and optional origin dates. Nothing is auto-promoted to a wiki.
- Knowledge shows origin/registration/review dates and supports a user-requested revisit that does not create a content revision. Old publications are not automatically marked stale or false.
- Reader hierarchy refinement keeps the PDF primary: compact page cue, secondary `기록 보기`, four-action selection language, unresolved-save return, exact scope/exclusion UI, and distinct AI-proposal/user-reviewed Knowledge states all reuse existing local state.
- Calm desktop polish: paper-neutral surfaces, muted semantic status colors with text/icon reinforcement, source-centered compact selection actions, clearer local-search empty states, and people-first Knowledge language. This is presentation-only and adds no persistence or AI behavior.
- Re-entry refinement: Library rows surface the existing resume page, unresolved count, and last-read cue. The Library top card keeps `이어서 읽기` as its only primary action and exposes `다시 볼 것` as a lightweight link into the existing unresolved Reader filter; the drawer can explicitly mark an item `이해 완료` after returning to its source. Settings separately labels one-way phone reading and PageDock recovery backup, while all existing backup entry points remain visible.
- Mobile Bridge: an explicit stable-document Mobile Shelf exports one phone-width, selectable-text PDF with study records, source-labelled AI answers, recall cards, anchored Knowledge, and disposable visual renders into a provider-neutral separate folder. Its convenience auto-publish is opt-in, coalesced, and rate-limited; it includes receipt/hash conflict protection and local-first verified automatic/manual backup copies, not cloud synchronization or two-way mobile editing.

## Implemented — 0.9

- Durable Visual Region Anchors: a compact Reader-only `영역 기록` mode for one user-drawn figure/table/equation/process-condition rectangle plus memo, an overlay, and a source-return list. It persists only document identity, page, normalized geometry, kind, memo, and timestamps in the existing sidecar; there are no persistent crops/thumbnails, OCR, multimodal AI, new SQLite schema, or backup format.
- Reader Follow-through / Evidence → Work Item: optional current-PDF `Finding` / `Verify` / `Discuss` / `Try` labels on source highlights, independent open/done state for follow-ups, separate learning/work record views that return to exact source text, an existing-highlight secondary AI Ask, compact Library resume/count summaries, and a structured source-linked Evidence Brief Markdown export. This is deliberately not a global task, project, meeting, or dashboard system.
- DeepSeek web bridge follow-through: persisted selection-anchored answers can always reopen the manual paste flow after reload, preserve a current-session draft per task, and show a source/question-aware comparison with shared Markdown/math rendering, keyboard focus containment, source return, and a small saved-answer selector. Session-file mutations are serialized and import retries are idempotent without changing the legacy JSON, SQLite, or backup contracts.
- Direct DeepSeek recovery: a bounded selection question is saved locally before the explicit web bridge even when the primary AI is unavailable; direct imports remain on the user anchor and show a single explanation until an actual primary assistant answer exists. Stable question retries, primary-failure recovery, and legacy assistant-owned imports are dual-read without a schema or backup change.
- Independent side-chat popup: a separate local `sidechat` session namespace now supports free PageDock AI questions, source handoff, independent provider state, per-task web answer/model draft recovery across tab/session/popup re-entry, and a compact saved-answer list without changing PDF history. DeepSeek, ChatGPT, Claude, and Gemini use explicit prompt preview/copy plus user-controlled paste/send; isolated Electron web partitions and safe system-browser fallback keep credentials and remote DOM outside PageDock. This is a semi-manual cross-check surface, not a provider API, automatic consensus, or web automation feature.

## Previously implemented — 0.8

- Source-Anchored Manual Cloze: one learner-selected, exact source span per PDF-selection card; the existing Today queue, source return, portable sidecar, and fixed review dates are reused without AI generation or automatic grading.

## Previously implemented — 0.7

- Current-PDF Today Recall: fixed date-only due queue for Source-Anchored Recall; new/legacy cards are due today, `again` returns tomorrow, and `remembered` returns in three calendar days without adaptive scheduling or a global dashboard.

## Previously implemented — 0.6

- Source-Anchored Recall: manual cards from PDF selections or existing anchored AI answers, answer-hidden current-PDF review, minimal `again`/`remembered` state, editable cards, and exact Reader source return while retaining portable sidecars.

## Previously implemented — 0.5

- PDF Study Loop: selection action bar, semantic study highlights, unresolved/resolved review, durable PDF chat source contexts and return markers, plus portable page/scroll resume without new SQLite or backup formats.

## Previously implemented — 0.4

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
- Explicit external-content-change approval and full compensation for failed internal PDF rename/move operations.
- Friend-focused first-run actions, native library-folder selection, masked account identifiers, minimum-window research layout, project maintenance, manual patent entry, Unpaywall DOI lookup, terminology editing, and expanded local FTS.
- Restore safety snapshot and a Python-free fallback for backup archives up to 512MB.
- PageDock-wide `?` help dialog with F1 access, screen-specific tips, full usage guidance, and troubleshooting.
- Device-local recursive knowledge memo-folder scan, unchanged-file fingerprints, local long-note split preview, and current-wiki Markdown export.
- Single-flight large-PDF indexing with real page progress, extraction-only cancellation, disposable OS-temp staging, source re-verification, and atomic chunk/FTS replacement.

## Planned

- P1: optional DeepSeek API transport behind a separately configured API key and the same explicit selection-only review boundary; keep the web-manual bridge as a no-key alternative and do not automate the consumer web chat.
- P1: highlight-to-quiz after the fixed due loop and manual Cloze are validated.
- P2: Tutor/Teach Me, Source Guide, figure/table/equation questions, session recap, and adaptive spaced repetition only if real recall use proves the need.
- P1: figure/table insight capture with caption, in-text mention, user interpretation, limitation, and existing page/rect anchor; the Mobile Bridge can render the existing deliberate record into its derived phone PDF, but no crop becomes Library data.
- P2: scoped AI discussion for private work observations and personal hypotheses, with every answer labelled by source basis; Tutor/Teach Me and Source Guide after that workflow proves useful.
- P3: multi-PDF source scope, cross-document comparison, rediscovering past highlights, and Evidence Matrix.
- Extend KIPRIS Plus citation and EPO OPS family/legal-event normalization.
- Improve PDF metadata extraction.
- Add Codex-assisted query expansion and optional result reranking with the current FTS result as a no-AI fallback.
- Replace the bounded in-memory backup fallback with a fully streaming Node extractor for very large archives.
- Add selected-page figure analysis UI and richer claim/paragraph anchors.
- Code signing and a hardened public installer release workflow.
- Improve knowledge candidate retrieval, add topic merge/split, and evaluate persisted queue counters only if interrupted real-world batches prove the need.

## Deferred

- WebView2 migration/installer size reduction.
- Embedding search, weekly radar, large-scale crawling, technology maps, inventor networks, automatic Samsung terminology dictionary.
- Live cloud synchronization, shared projects, two-way mobile note merge, Inbox ingest, and internal company models/data.
- Local LLM and embedding-model integration.

## Excluded

- macOS/Linux builds, packaging, signing, compatibility work, and distribution. PageDock supports Windows 10/11 x64 only.
- Paywall bypasses, Sci-Hub/mirror discovery, publisher credential collection.
- Legal freedom-to-operate judgments.
