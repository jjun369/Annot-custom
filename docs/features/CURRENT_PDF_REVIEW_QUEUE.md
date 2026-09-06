# Current-PDF Review Queue

Status: Implemented in PageDock 0.7.0.

## Purpose

The first Recall release let a learner make and answer source-anchored cards. This follow-up closes the smallest missing loop: the current PDF shows which cards should be recalled today without turning PageDock into a global flashcard product.

```text
Create card → today queue → recall → again / remembered → next local calendar day
```

## Rules

- Scope is the PDF currently open in the Reader. There is no library-wide Today page, background scheduler, notification, or derived index.
- A newly created card is due today.
- `다시` schedules the card for the next local calendar day.
- `기억함` schedules the card for three local calendar days later.
- The compact dialog defaults to `오늘 복습` and retains an `전체 카드` view so no existing card becomes inaccessible.
- When today has no due card, PageDock shows the earliest future date instead of adding streaks, XP, or celebrations.

## Storage and compatibility

The only persistent addition is optional `StudyCard.review.nextReviewDate`, a validated `YYYY-MM-DD` local date. It remains inside the existing v1 `.annot` `study.cards` structure, so sidecar version, SQLite schema, and backup manifest do not change.

Cards created by 0.6 lack the field. They load as due cards, and opening or closing a PDF does not rewrite their sidecar. The field first appears only after a learner evaluates the card or creates a new one. Source contexts, highlights, sessions, rename/move recovery, and backup continue to use their existing contracts.

## Deliberately excluded

- SM-2, FSRS, adaptive intervals, difficulty scores, lapse counts, event history, or a review calendar.
- Cross-PDF queues, a global dashboard, push notifications, streaks, XP, and gamification.
- Cloze, quiz, automatic card creation, cloud AI, TTS, concept maps, and wiki changes.
