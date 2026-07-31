# Personal knowledge inbox

Status: Experimental implementation included in the PageDock 0.4.3 working tree.

## User goal

The user continuously writes loose Korean/English technical notes in ordinary text files. PageDock should accept those notes with almost no preparation, use Codex through the user's ChatGPT OAuth login to propose a coherent topic wiki, preserve contradictions, and keep every derived statement traceable to the untouched source note.

The user is a reviewer, not a classifier. Capture must not require a title, tag, folder, or ontology.

## Primary flow

1. Paste text or drop multiple `.txt`, `.md`, or `.markdown` files into the inbox.
2. Exact duplicate contents are skipped by SHA-256 regardless of filename.
3. Run one note, the next ten, or the explicitly confirmed full queue. Processing is sequential, stops on the first error, supports both stop-after-current and immediate cancellation, and never creates uncontrolled concurrent Codex turns. Each Codex execution has a 285-second application timeout and the app does not automatically retry it.
4. Local term matching selects at most eight candidate topics. `knowledge-ai.ts` additionally caps candidate context to about 36,000 characters total and 6,000 per topic. Long topics use explicit head/tail excerpts, and every affected review retains a visible context warning.
5. Codex returns schema-constrained `create`, `update`, or `conflict` proposals.
6. The user reviews a line diff, optionally edits the proposed title/summary/Markdown, then accepts or rejects it.
7. Accepted creates/updates and direct user edits append a monotonic topic revision. Accepted conflicts create a separate open conflict and do not modify the current wiki.

## Authentication contract

Knowledge processing is deliberately ChatGPT-OAuth-only. The server route must require both:

```text
authenticated === true
authMethod === "ChatGPT"
```

Do not weaken this check to generic Codex authentication. Generic authentication would also accept API-key billing, which directly violates the user's requirement. The UI check is explanatory only; the server check in `api/knowledge/process` is authoritative.

OAuth removes direct API-key setup and API-key billing. It does not make processing local. The UI must continue to state that the selected source note and candidate topic excerpts are sent to OpenAI through Codex.

Authentication status is demand-driven rather than polled. Check on knowledge-page entry, explicit refresh, reconnect completion, and authoritatively before each AI run. A generic error must never call logout or discard the last known good UI state; it changes the display to `연결 확인 필요` and keeps local knowledge features available.

## Storage and migration

Path: `.annot/knowledge-store.json`

Current format: version 2. `normalizeStore` reads both the original version-1 shape and version 2. Version 1 topics receive a synthetic current revision, notes receive a content hash/source name, pending reviews receive the current topic revision as their best-effort base, and conflicts default to an empty list.

Reading v1 is non-mutating. Immediately before the first v2 write, the exact v1 bytes are verified and preserved once as `.annot/knowledge-store.v1-backup-<sha256-prefix>.json`. The backup is published through a hard link from a completed temporary file, so a crash cannot expose a partially written rollback copy. The v2 store itself is serialized and validated, written to a temporary file, and atomically renamed. The existing portable-backup collector includes both files as ordinary library files. Do not move knowledge data into the research SQLite schema without a separate ADR, migration test, rollback plan, and backup compatibility test.

Historical revisions may be moved to `.annot/knowledge-revision-trash.json`. The current revision is protected. Trash is written before the active revision is removed; restore writes the active copy before deleting the trash entry. Both orders prefer a recoverable duplicate over data loss. Permanent deletion is a separate confirmed action. The trash file is included in portable backups.

## State and invariants

Note states:

```text
inbox -> review -> integrated
               -> dismissed
error -> review (after retry)
```

Critical invariants:

- `rawText` is immutable after capture.
- A pending update records `baseRevision`; acceptance fails when the current topic revision differs.
- Topic revision numbers are monotonic. Restoring an old revision creates a new revision rather than deleting history.
- A conflict never changes `KnowledgeTopic.bodyMarkdown` merely because it was accepted into the conflict queue.
- Rejected proposals are retained for audit; a fully rejected note becomes `dismissed`, not silently reprocessed.
- AI output never writes storage directly. Application code validates and applies it.
- Candidate context stays bounded. Do not send the whole library to Codex.
- A cancelled Codex run returns the untouched note to `inbox`; it never creates a partial review.
- Batch processing stops at the first failed note. Retrying always requires an explicit user action.
- Direct wiki edits create a user-authored revision and preserve source-note links.
- The current topic revision can never enter the revision trash.
- Review diffs are calculated only after the user opens the review detail.

## Code map

- `src/lib/knowledge-store.ts`: versioned persistence, migration, state transitions, revision/conflict rules.
- `src/lib/knowledge-ai.ts`: bounded context and structured Codex prompt.
- `src/lib/knowledge-auth.ts`: shared OAuth-only predicate used by both UI and server.
- `src/lib/knowledge-diff.ts`: dependency-free bounded line diff.
- `src/app/api/knowledge/**`: capture, OAuth-gated processing, review editing/resolution, conflicts, restore.
- `src/app/api/knowledge/auth`: fast, no-cache CLI OAuth status for the knowledge UI; processing still rechecks authorization independently.
- The knowledge page calls the auth endpoint once on entry and again only after explicit refresh or reconnect. Ordinary data refreshes never spawn a CLI status process.
- `src/app/knowledge/page.tsx`: orchestration and top-level UX.
- `src/components/knowledge/KnowledgeReviewCard.tsx`: proposal diff/edit/accept UI.
- `src/components/knowledge/KnowledgeWikiPanel.tsx`: direct editing, history, revision trash, and source UX.
- `src/components/knowledge/KnowledgeConflictCard.tsx`: conflict evidence and resolution notes.
- `docs/KNOWLEDGE_USER_GUIDE_KO.md`: end-user instructions and recovery guidance.
- `tests/knowledge-core.test.ts`: data safety invariants.
- `tests/knowledge-diff.test.ts`: diff behavior.

## Known limitations and next revisions

1. Browser file import treats each file as one note; large compound files need a deliberate section-splitting UX.
2. Batch processing is sequential and safely stops at the first failure. The note states persist, but the visible done/total counter does not resume after an app restart.
3. Candidate retrieval is lexical and may miss semantically related Korean phrasing. Evaluate SQLite FTS/trigrams or an optional local embedding model only after real-note tests.
4. The wiki has local browsing/search, direct editing, revision restore, and recoverable history cleanup, but no topic merge/split or Markdown folder export yet.
5. Conflict resolution captures an explanation and can open the related wiki for a direct edit, but it does not automatically generate or apply a resolved topic proposal.
6. Line diff collapses long unchanged runs and preserves common prefixes/suffixes in the large-document fallback. It is still line-based rather than word-based.
7. Knowledge remains a separate PageDock area by design. Avoid coupling it to PDFs/research tables until actual usage proves that relationship.

## Do not do this

- Do not auto-apply AI proposals.
- Do not accept API-key authentication for knowledge processing.
- Do not overwrite a topic from a stale proposal.
- Do not add automatic model retries; retries must remain explicit because OAuth usage limits still matter.
- Do not remove the v1 rollback copy or silently truncate candidate context.
- Do not turn every apparent contradiction into a replacement fact.
- Do not ask the user to classify notes during capture.
- Do not add graphs, chat, web research, or elaborate ontologies before the capture/review loop is proven with real notes.

## Verification

Run:

```powershell
npm run docs:check
npm run lint
npx tsc --noEmit --incremental false
npm run test
npm run build
```

Real-use validation should include 30-50 mixed Korean technical notes, duplicate files, two proposals generated from the same topic revision, version-dependent facts, a genuine unresolved contradiction, interrupted batch processing, proposal editing, and revision restoration.
