# ADR 0024: Side-chat reflection stays on the user question

- Status: Accepted
- Date: 2026-09-07

## Context

After reading one or more independent explanations, a reader needs a small place to record what they understood or still need to check. That note must not be mistaken for a PageDock answer, a PDF annotation, or a verified conclusion.

## Decision

Store an optional `sideChatReflection` object (`text`, `updatedAt`) on the canonical user question message in an existing `sessionKind: "sidechat"` session. Saving is explicit and may clear the field with an empty note. The comparison and single-answer views use the same question record, so changing the selected explanation does not create or switch a second note.

The reflection route validates the sidechat session, user-question id, and a bounded text length, then applies a latest-state message patch inside the existing `sessions.json` mutation lock. It does not replace a stale messages array. A late response can update only its original session/question; it cannot replace the currently displayed session or draft.

## Consequences

- Reflections are local sidechat records and are not copied to PDF chat history, highlights, `resolvedAt`, Knowledge, cards, provider prompts, or web handoff payloads.
- The existing session JSON and portable backup v2/v1 dual-read behavior carry the optional field. SQLite schema and backup manifest remain unchanged; old records simply have no reflection.
- No AI grading, winner, consensus, automatic resolution, or forced writing step is introduced.
- The web handoff panel may remain compact by progressively disclosing the answer-import controls; immutable request receipts and manual copy/paste remain unchanged.
