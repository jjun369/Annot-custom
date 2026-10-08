# PageDock knowledge/learning fit — two-round review

Date: 2026-10-08. Scope: the existing local Reader → own-words → retrieval → reuse loop, using the current working tree. This is product/code review, not a claim that a PDF or installed UI was visually inspected.

## Round 1 — strongest case and skeptical cost

**Fit case:** PageDock already has the expensive learning primitives: exact Reader anchors, user-owned notes, finite recall, Studio drafts, provenance-aware Knowledge, and explicit review gates. The missing high-value link is re-entry: a prior Studio synthesis is findable in Studio, but it is absent from the shared record search used by concept synthesis and opt-in Library chat. A reader can therefore repeat a synthesis without deliberately rediscovering prior working notes.

**Skeptical case:** making AI-generated synthesis reusable risks self-citation and apparent evidence inflation. Another global search scope, a new store, forced reflection, auto-cards, or automatic wiki promotion would increase cognitive and privacy costs. The existing synthesis prompt already asks for a record-grounded retrieval check and next action; changing that wording or enforcing its Markdown format would not close the observed re-entry gap.

## Round 2 — challenge against implementation and workflow

Inspection confirmed the gap in `record-retrieval.ts`: local Library search included Reader sidecars, Knowledge, and Sources/Studio sources, but not saved `StudioDraft.text`; document retrieval likewise lacked drafts. Studio itself already searches and deep-links drafts by stable ID. The current UI also already provides exact source preview/hash revalidation for synthesis, opt-in/default-off PDF record lookup, selected-record limits, and review-gated Knowledge capture.

**Accepted, one cohesive improvement:** expose saved Studio drafts in the existing retrieval path, but keep Synthesis's existing source-only search default and add one explicit `저장한 Studio 초안도 검색` choice. Drafts use a stable `studio-draft:<id>` canonical ID, a distinct `Studio 초안 · Knowledge 미게시 · 미검증 · 문헌 근거 아님` label, bounded excerpts, and existing canonical resolution/hash guards. Reader lookup stays default-off; current-PDF retrieval may include a draft only when its saved reference snapshot anchors to the same stable document and exact page if page-scoped. Never borrow an arbitrary cited PDF anchor for the draft. Return actions open the draft ID in Studio, while that draft's original references remain separately linked. Provider instructions treat drafts as prior interpretations, not literature evidence, and do not assume the user's draft was AI-authored. No storage/schema, vector index, or provider change.

**Rejected:** a second reflection scaffold/button in Studio. The editor is already free-form and locally saved; concept synthesis already requests a source-grounded retrieval question and next action. A new template would add a visible step without solving a separate evidenced failure. Also rejected auto-generated cards, a global study dashboard, and draft-to-wiki promotion because existing manual Recall and review gates already own those transitions.

Independent read-only peer review corroborated the draft-reuse gap and found no need for auto-cards/vector search. A separate external advisor could not be dispatched because its browser route failed before submission; no external response is represented here. No live AI request was made.

## Validation boundary

Source-level focused tests and static checks/build are recorded in `CURRENT_STATE.md`. Any browser screenshot is synthetic-only and reported separately; repository/API checks alone do not establish visible-screen quality.
