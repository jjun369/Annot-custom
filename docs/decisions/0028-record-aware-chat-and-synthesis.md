# ADR 0028: Explicit record context for Reader chat and synthesis

- Status: Accepted
- Date: 2026-10-03

## Context

PDF sidecars, personal Sources/Studio notes, Knowledge captures/wiki topics, and Reader conversations already preserve useful source-linked material, but normal PDF chat does not retrieve those records. Sending a whole Library implicitly would violate PageDock's local-first, bounded-context, and provenance boundaries. Readers also need a deliberate way to synthesize mixed notes without treating a generated answer as verified or replacing an existing note.

## Decision

1. The normal Reader PDF chat gains an opt-in, default-off per-turn record lookup. It searches only the active PDF's sidecar, PDF-anchored Knowledge notes, and PDF-anchored Studio sources or saved Studio drafts. A draft is eligible for the current PDF only when its persisted reference snapshot points to that stable `documentId` (and requested page, when present). Other PDFs and free-standing private notes/drafts require explicit selection in the synthesis workflow; there is no implicit whole-Library Reader lookup.
2. A server-only projection reuses existing sidecar, Knowledge, Sources/Studio sources and drafts, and stable document identities. It reads no PDF originals and creates no canonical store, SQLite migration, embedding index, or backup change.
3. The user question drives deterministic local term matching. At most six records and 8,000 total record-text characters are attached, with short source-labelled excerpts and visible omissions. Text-only records may be sent only after the user enables the control for that question; image bytes are never included.
4. Studio drafts are reusable working material, not canonical evidence or reviewed Knowledge. Their exact `studio-draft:<id>` identity and visible `Studio 초안 · 위키 미게시 · 사실 검증 전` provenance distinguish them from captured sources and current wiki topics; a draft citation must not be presented as source verification. The exact included record references and bounded excerpts are stored additively on the canonical user chat message so the UI and persisted history show the actual outbound context. Existing messages without the field are unchanged. Providers receive the same record block for CLI and fallback transports; record contents are explicitly untrusted source data.
5. Sources synthesis is a separate explicit action. Search is local and sends nothing. The user selects bounded records and confirms the exact request preview before the chosen existing provider runs. Its answer is an isolated proposal, not a saved note, verified claim, wiki edit, conflict resolution, or revision.
6. The user may save the proposal as a new ordinary Studio draft with stable source references, then use Studio's existing explicit source-note capture and Knowledge review/revision acceptance. Existing material is never overwritten by synthesis.
7. Evidence excerpts, paper claims, user observations/hypotheses, and AI inferences remain labelled separately. Missing sources and omitted context are disclosed; source anchors use stable IDs and only current paths as navigation hints.

## Consequences

- Default PDF-chat behavior and the independent side-chat boundary remain unchanged.
- Local keyword retrieval may miss semantic paraphrases. Search is bounded and deterministic; no vector service or new schema is introduced.
- A saved chat turn retains the exact bounded record snapshot that it actually sent, not a promise of durable provider memory.
- Saved Studio drafts can be found again through the existing local record search and included only through the existing explicit synthesis selection or Reader record-context preview. Their text remains a revisitable interpretation, never an automatically promoted source or wiki revision.
- Generated content enters existing review gates only after a deliberate user save and capture action.

## Verification

Synthetic tests cover per-document scope, provenance labels, query ranking, deduplication, record and total-text bounds, missing sidecars, no retrieval when off, explicit selected synthesis scope, and unchanged Knowledge/SQLite/backup formats. Provider tests verify common untrusted-context construction without a real model call.
