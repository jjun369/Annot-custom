# Work Evidence Brief

Status: Implemented in PageDock 0.9.0.

## Purpose

PageDock's Reader is for professional technical reading as well as personal study. This feature closes the smallest useful work loop without turning the app into a task manager.

```text
Read → underline exact evidence → record what it means or what to do → return to source → export a compact brief
```

## Create and review

- Select text in one PDF page, choose `업무 후속…` in the compact selection bar, then choose a classification.
- Choose exactly one classification:
  - `Finding`: what the evidence means for the user's product, process, or design.
  - `Verify`: data, conditions, or literature that still need checking.
  - `Discuss`: a point to bring to a colleague or meeting.
  - `Try`: an analysis, simulation, experiment, or process check worth attempting.
- The selected text becomes the usual anchored highlight. The existing highlight note is the interpretation or follow-up text; it is optional and can be added later.
- `읽기 기록` separates `학습` from `업무 후속` while projecting the same source anchor into either view. Its cards return to the exact PDF source first; editing is secondary. Findings are explicit records, not open or completed tasks.
- Only Verify, Discuss, and Try have `완료` / `다시 열기`. A Finding is a recorded interpretation, not a task. Study `이해됨` and work completion are separate states.
- Existing highlights can be asked about again through the highlight dialog footer's secondary `AI에게 묻기` action. It reuses the existing exact source context and never runs automatically when the dialog opens.

At compact desktop widths, Reader keeps a 640px minimum. The Library rail compacts first; Chat and `읽기 기록` use one auxiliary slot rather than becoming four simultaneous columns. If space remains insufficient, the active auxiliary panel becomes an overlay with Escape-to-close behavior.

## Evidence Brief export

The Reader's export menu retains `하이라이트 Markdown` and adds `업무 Evidence Brief`. Its structured preview uses the same Finding/open/completed selector as `읽기 기록`. The export itself remains limited to work-classified highlights in the currently open PDF:

```markdown
# Evidence Brief — paper-title

## Findings

### 1. FINDING — our interpretation

> exact highlighted source text

[p. 12](/?pdf=...&page=12)

## Open Follow-ups

### 1. VERIFY — short note or source excerpt
```

Completed actions appear separately. A blank note never triggers automatic AI wording: the export uses a short source excerpt as its heading and always preserves the full exact highlighted text below it.

The preview also shows unresolved learning highlights as local reading context, clearly marked as not included in the downloaded work-only Markdown.

## Follow-through summary

The Library tree batch-derives an optional compact line from existing portable data only:

```text
p.37에서 이어 읽기 · 이해 필요 2 · 업무 열림 3
```

It reads `PaperMetadata.readingPosition` and existing sidecar highlights; it does not create a queue, database table, task record, or AI request.

## Storage, safety, and backup

This is an additive extension of each existing v1 `.annot` annotation sidecar:

```json
{
  "id": "highlight-id",
  "page": 12,
  "text": "Exact source evidence.",
  "note": "Check whether this applies to our process window.",
  "workKind": "verify",
  "workDoneAt": "2026-08-31T12:00:00.000Z"
}
```

- `workKind` is optional: `finding | verify | discuss | try`. Missing means an ordinary highlight.
- `workDoneAt` is optional, valid only for Verify/Discuss/Try, and is removed when the kind changes or Work is removed.
- Existing `note`, `studyKind`, `resolvedAt`, source anchors, cards, native-PDF type, and document identity keep their existing meanings.
- Work-only changes stay in the sidecar and do not require PyMuPDF. The feature works offline with no AI, network, or Python.
- No SQLite schema, sidecar version, backup manifest, project/task object, deadline, assignee, tag, global queue, or cloud data is introduced. Existing backup/restore, rename/move, and stable-document identity flows preserve optional sidecar fields automatically.

## Deliberately deferred

AI work-item suggestions, global/cross-PDF work queues, project/meeting linkage, owner/due dates, reminders, collaboration, task history, priority, statistics, evidence graphs, and automatic Knowledge promotion remain out of scope.
