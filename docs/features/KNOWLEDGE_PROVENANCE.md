# Provenance-gated Knowledge promotion

Status: Implemented in the working tree after PageDock 0.9.

## Purpose

PageDock is for a professional reader who accumulates papers, work observations, hypotheses, and AI conversations over years. A useful excerpt must remain useful without making an old paper, an internal observation, or an AI synthesis look like timeless fact.

This feature adds a small bridge from the Reader to the existing Knowledge inbox. It deliberately does not build a second note database, a new wiki editor, a trust score, or an automatic “outdated knowledge” engine.

## Capture flow

1. In an existing PDF highlight dialog, choose `지식 후보로 보내기`; the current note is offered as a collection memo.
2. On a persisted assistant answer, choose the same action.
3. Confirm one source class and, if useful, an original date and collection memo.
4. The candidate is stored as a normal immutable `KnowledgeNote` in the existing inbox.
5. Existing Knowledge processing may later propose a create, update, or conflict. The user still reviews and accepts it before the wiki changes.

Direct notes in Knowledge can also be identified as a personal hypothesis, work observation, or literature claim before capture.

## Provenance classes

| Stored value | UI label | Meaning |
| --- | --- | --- |
| `literature_claim` | 문헌 주장 | A statement actually present in a paper or other source. |
| `work_observation` | 업무 관찰 | A direct observation from the user’s work. |
| `personal_hypothesis` | 개인 가설 | The user’s interpretation, assumption, or idea. |
| `ai_inference` | AI 추론 | An AI-produced explanation or synthesis. |

The class is an origin label only. It is not a confidence score, accuracy rating, or permission to auto-promote content. An AI answer remains `AI 추론` even if it has a source anchor; a user may deliberately change the class only after checking the actual source.

## Dates and review attention

An optional `originDate` means publication, observation, authoring, or AI-answer generation date depending on the selected class. The system also shows the registration time and, when present, the last human review time.

There is no automatic age threshold. An older paper can remain correct, and a new note can be wrong. `재검토 표시` exists only when a user requests it. `재검토 완료` records `lastReviewedAt` and clears the attention marker; it does not mutate the body, `updatedAt`, or revision history.

Future source-content replacement detection may use the existing document identity conflict mechanism to recommend attention. It must never infer this state merely from elapsed time.

## Storage and backup

The existing `.annot/knowledge-store.json` format remains version 2. Optional additions are:

- `KnowledgeNote.provenance`
- `KnowledgeNote.sourceAnchors` using the bounded existing `ChatSourceContext` shape
- `KnowledgeTopic.provenance`
- `KnowledgeTopic.trust`
- optional provenance copied into a topic revision for historic restore accuracy

No SQLite table, sidecar version, backup-manifest version, vector index, cloud service, or background AI job is added. The normal portable backup already includes the knowledge JSON. Old notes and topics without these fields are rendered as `유형 미지정 · 기존 지식` and are not rewritten just because the app opened them.

## Privacy and limits

Reader promotion is local until the user explicitly asks the existing Knowledge AI workflow to process its inbox entry. The existing ChatGPT OAuth disclosure and bounded candidate-context rules still apply. Source text, notes, and prompts are not logged.

## Intentionally deferred

- Figure/table insight capture. A later P1 item should retain caption, in-text mention, user interpretation, limitation, and existing page/rect anchor before considering any crop workflow.
- AI discussion over mixed private work notes and public literature. This needs explicit source scope and answer provenance labels, not an implicit merged prompt.
- Automatic freshness scores, expiry dates, or auto-replacement of knowledge.
- Global graph/vector search, cloud sync, collaboration, or a NotebookLM clone.
