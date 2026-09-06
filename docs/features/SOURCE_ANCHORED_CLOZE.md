# Source-Anchored Manual Cloze

Status: Implemented in PageDock 0.8.0.

## Purpose

Manual Cloze adds one precise recall form to the existing Reader learning loop without creating a second flashcard system.

```text
Read → select one PDF sentence → choose one original-text span → hide it → Today review → return to source
```

It is local-first and self-rated. PageDock never asks AI to choose the answer, infer an answer, or grade a learner's response.

## Create and edit

- Select normal text inside one PDF page, open the selection bar's more menu, and choose `빈칸 카드`.
- In the compact editor, select one continuous short non-whitespace span inside the displayed source excerpt. The preview renders that span as `[…]`.
- A Cloze stores the original selection source unchanged. Editing opens the same source excerpt and lets the learner choose a different hidden span; it never provides a free-text answer editor.
- If the original source was wrong, delete the card and create one from a new PDF selection. Cloze editing never mutates document identity, page, rects, or source text.

## Review

The current PDF's existing `오늘 복습` queue mixes basic and Cloze cards. A Cloze starts with the exact answer hidden, then `답 보기` reveals the original sentence with the answer span emphasized. The learner still chooses `다시` (tomorrow) or `기억함` (three local calendar days later); PageDock makes no automatic correct/incorrect decision. `원문 보기` uses the existing source anchor and PDF focus behavior.

## Storage and backup

Cloze is an additive extension of the existing v1 `.annot` annotation sidecar:

```json
{
  "study": {
    "version": 1,
    "cards": [
      {
        "kind": "cloze",
        "sourceContext": { "scope": "selection", "page": 12, "text": "The mitochondrion is the powerhouse of the cell." },
        "clozeText": "mitochondrion",
        "clozeStart": 4,
        "clozeEnd": 17
      }
    ]
  }
}
```

The invariant is `sourceContext.text.slice(clozeStart, clozeEnd) === clozeText`. The blank is derived only while rendering; PageDock does not store Anki-style `{{c1::...}}` markup in source text. Existing cards with no `kind` remain basic cards without a migration write. SQLite schema 1 and portable backup manifest v2 are unchanged, and the normal sidecar backup/restore path includes Cloze state automatically.

## Local-first behavior and limits

- Cloze creation, editing, review, source return, rename/move recovery, backup, and restore work without AI, network access, or Python/PyMuPDF.
- One card has one continuous hidden range and a bounded short answer. Malformed stored Cloze data is shown safely as a basic card rather than crashing the Reader or exposing an invalid hidden answer.
- Deferred: automatic Cloze generation, multiple blanks, answer normalization or grading, quiz choices, cross-PDF Today, statistics, and adaptive SRS.
