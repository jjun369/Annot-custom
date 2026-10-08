# Record-aware PDF chat and concept synthesis

## Product contract

- PDF chat local-record lookup is explicit opt-in and starts OFF. OFF performs no new record lookup or attachment. When enabled, the query is prepared locally after a short debounce; the default scope is the current PDF. Library scope is a deliberate user choice.
- The local server resolves records from existing sources (Reader sidecar, Knowledge, Sources/Studio) using canonical IDs and the persisted PDF session `documentId`. It does not open PDF originals or attach image bytes. At most eight selected record excerpts and 8,000 excerpt characters are sent. Users can exclude suggestions and inspect the exact outbound excerpts, source labels, and omitted counts.
- The prepared snapshot carries a local SHA-256 fingerprint. Chat and synthesis routes re-resolve records and reject stale previews rather than silently changing what the user approved. Record text is escaped JSON data, treated as untrusted reference material, and passed through the same bounded prompt block for Codex CLI, existing account fallback, and Claude.
- Turning the option OFF prevents future record retrieval; it cannot recall text previously sent in this conversation or provider history. The independent `/side-chat` has no implicit Library context.
- Concept synthesis uses only the records the user selects and confirms. Output is an AI proposal with provenance distinctions and remains a new Studio draft. Only the existing explicit Knowledge inbox/review/revision path can publish a wiki revision.
- Search cards show a query-centered excerpt and the count of results omitted by the 40-card display; the local candidate search is capped at 100, which the UI discloses. A new query clears stale discovery cards but never the explicit canonical-ID selection basket; searching never preselects records, and selected records remain eligible even when a different query no longer returns them.
- The synthesis prompt requests one source-grounded retrieval-practice question and one concrete next-reading/verification action in addition to evidence/provenance distinctions. These remain model instructions, not enforced output fields; the saved draft stays editable and requires human review.
- Searching for saved Studio drafts is an explicit opt-in in concept synthesis. Drafts stay absent from synthesis search and canonical ID resolution unless that option is enabled; when selected, their stable `studio-draft:<id>` identity and `Studio 초안 · Knowledge 미게시 · 미검증 · 문헌 근거 아님` label travel with the exact bounded, hash-checked preview. Reader chat's existing record lookup remains default-off; current-PDF lookup includes a draft only when one of its saved reference snapshots points to the current `documentId` and requested page. Drafts have no borrowed PDF anchor, open by their exact Studio draft URL, and remain working interpretations rather than original-source evidence.
- Original source references saved inside a draft remain separate references. A reused draft does not become a canonical source bundle, and provider instructions must not assume user-authored draft text was AI-generated.
- Saving a generated concept proposal remains enabled only while the question, provider, selected record IDs, and exact prepared snapshot still match the inputs used to generate that proposal.
- Saved Studio drafts can be searched locally by title/body/reference snapshot and reopened by stable draft ID; the saved reference shelf is restored. Draft-list labels distinguish Studio material not yet published to Knowledge. This does not replace or reorder the Library's Reader-first resume affordance.

## Persistence and limits

The chat user message may persist an additive `recordContext` snapshot for replay and disclosure. Stable record/source IDs and anchors remain authoritative; paths are not identity. Synthesis references are stored with a new Studio draft as source snapshots. No new canonical record store, SQLite schema, sidecar format, or backup manifest was introduced. Image attachments are not sent.

## Verification scope

Synthetic tests cover retrieval scope and bounds, edited memo projection, prompt delimiter safety, default-off/provider boundary, and Studio draft source snapshots. Focused test and static-check outcomes are maintained in `CURRENT_STATE.md`. No live provider call, installer, release, or packaged application validation is implied.
