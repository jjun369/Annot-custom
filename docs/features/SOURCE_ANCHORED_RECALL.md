# Source-Anchored Recall

Status: Implemented in PageDock 0.8.0.

## Purpose

Source-Anchored Recall closes the Reader learning loop without turning PageDock into a separate flashcard platform. A learner can save an editable question-and-answer card from a selected PDF sentence or an already anchored AI answer, recall the answer later, and return to the exact source.

```text
Read → select / ask → save card → today queue → hide answer → recall → choose next date → inspect source
```

## User flow

- A normal single-page text selection offers `카드`; the learner writes the front and back themselves.
- The same selection's more menu offers `빈칸 카드`; the learner chooses one short exact source span to hide. The dedicated Cloze interaction is documented in [SOURCE_ANCHORED_CLOZE.md](./SOURCE_ANCHORED_CLOZE.md).
- An assistant answer with an existing selection or page source offers `복습 카드로 저장`; the linked question and answer are editable before saving.
- The Reader toolbar opens the current PDF's compact Review dialog. It opens on `오늘 복습`, with an `전체 카드` fallback. It shows the question first, then `답 보기`, `다시` (내일), `기억함` (3일 뒤), and `원문 보기`.
- Editing or deleting a card affects only the card. It never edits or deletes its source highlight or AI conversation.

## Storage and portability

Cards are optional additive state inside the existing per-document annotation sidecar:

```json
{
  "version": 1,
  "highlights": [],
  "study": {
    "version": 1,
    "cards": [
      {
        "id": "...",
        "documentId": "...",
        "sourceContext": { "scope": "selection", "page": 12, "rects": [], "text": "..." },
        "front": "...",
        "back": "...",
        "origin": "selection",
        "review": { "reviewCount": 1, "lastResult": "remembered", "nextReviewDate": "2026-09-03" }
      }
    ]
  }
}
```

`sourceContext` is the same durable locator used by Reader/Chat. It contains no mutable filesystem path. Existing sidecars have no `study` property and simply load with no cards. Sidecar version remains 1; SQLite schema and portable backup manifest remain unchanged.

`review.nextReviewDate` is an optional local calendar date (`YYYY-MM-DD`), not a timestamp. A new card is due today; `다시` writes tomorrow and `기억함` writes three calendar days later. A 0.6 card with no date is treated as due, but merely loading it never writes a migration.

Cards use the same atomic sidecar writer as highlights. Internal rename/move follows stable document identity, and normal portable backup includes the sidecar as it already does.

## Local-first behavior

- Manual card creation, editing, review, source navigation, backup, and restore work without AI or Python/PyMuPDF.
- AI is not required to create a card. An AI answer only provides a convenient, editable card draft.
- No full PDF text is duplicated for cards; only the existing bounded source context is retained.

## Deliberately deferred

- SM-2, FSRS, adaptive intervals, notifications, streaks, XP, and review calendars.
- Cross-PDF daily queues, a global study dashboard, and derived SQLite indexes.
- Auto-generated cards, quizzes, TTS/audio, concept maps, and wiki/backlinks.

Those features are considered only after users demonstrate that source-grounded manual recall is valuable.
