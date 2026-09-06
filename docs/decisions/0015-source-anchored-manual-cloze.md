# ADR 0015: Source-anchored manual Cloze inside existing cards

Status: Accepted for PageDock 0.8.0.

PageDock needs one additional active-recall expression without expanding the Reader into a global flashcard or quiz system. A manual Cloze is chosen because it retains an exact PDF sentence and reuses the existing source-anchored card, current-PDF Today queue, fixed date-only schedule, source return, and portable sidecar path.

The canonical record remains one optional entry inside the existing v1 annotation sidecar's `study.cards` array. New Cloze cards add `kind: "cloze"`, `clozeText`, `clozeStart`, and exclusive `clozeEnd`; the offsets locate one continuous source substring and are validated with `sourceContext.text.slice(clozeStart, clozeEnd) === clozeText`. `sourceContext`, document identity, page, rects, and original source text remain immutable. The blank is a renderer concern, not source markup, so PageDock does not introduce `{{c1::...}}`, a new source locator, a Cloze sidecar, or a migration framework.

Existing cards omit `kind` and retain the prior basic recall renderer. New basic cards write `kind: "basic"`; reads never require rewriting historical card JSON. A malformed Cloze falls back to a safe basic renderer so one corrupted card cannot stop the Reader or Today review from loading. Deliberate create and edit operations reject invalid source ranges rather than silently guessing an answer.

The feature has no AI generation, automatic answer grading, multi-cloze support, choice generation, separate review queue, statistics, global dashboard, SQLite schema/table, backup manifest change, interval/ease/lapse state, or adaptive SRS. Review remains self-rated: `again` schedules tomorrow and `remembered` schedules three local calendar days later.
