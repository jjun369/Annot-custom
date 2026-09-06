# P0-0 code ownership audit — 2026-08-31

This is the repository-grounded inventory required before the Study Space schema or
navigation work begins. Paths below were verified by code search; they are not a proposed
new architecture.

| Concern | Current owner | P0 direction |
| --- | --- | --- |
| Global document / project / source M:N | `src/lib/research-db.ts` (`documents`, `projects`, `project_documents`) | Reuse `Project.id` and `ProjectDocument`; do not copy or rename rows. |
| Analysis and source evidence | `src/lib/research-db.ts` (`analysis_reports`, `evidence_anchors`) | Preserve existing data and locator implementation; do not make these tables polymorphic. |
| Knowledge review pipeline | `src/lib/knowledge-store.ts`, `src/app/knowledge/page.tsx` | No P0 data or workflow change. |
| Research compatibility UI | `src/app/research/page.tsx` | Keep route/deep links during the transition. |
| Portable export, import, safety backup | `src/lib/library-backup.ts`; API routes under `src/app/api/library/{backup,import}` | Extend atomically with a future additive entity write; retain current snapshot-before-import behavior. |
| Current automatic backup trigger | `src/app/page.tsx` (24-hour localStorage gate and delayed POST) | Move only after a scheduler owner/design is tested; page mount must not remain the owner. |
| Library tree and landing selection | `src/app/page.tsx`, `src/components/tree/TreeExplorer.tsx`, `src/lib/tree-utils.ts` | Separate empty library from populated-but-unselected reader state. Implemented in this first slice. |
| Reader annotation/subprocess-facing failures | `src/components/workspace/PdfViewer.tsx`, workspace annotation routes | Do not render backend/process errors. Implemented in this first slice; console diagnostics remain developer-only. |
| Detached chat entry and moving context | `src/components/layout/Topbar.tsx`, `src/app/page.tsx`, `src/app/chat-window/page.tsx` | Stop new primary-flow entry and replace the context model only with `spaceId + documentId + conversationId`; preserve legacy conversations. |
| Current workspace context | `src/lib/workspace-store.ts`, `src/app/page.tsx` | Treat path/folder state as legacy UI context, not as a new Study Space identity. |

## First slice completed from this audit

- `hasPdfDescendant` now lets the Library landing state distinguish no documents from a
  document awaiting selection.
- `PdfViewer` now uses user-safe messages for annotation load/migration/save/delete,
  note save, Markdown preview, and translation failures. Raw process strings remain out of
  the reader DOM.
- `tests/pdf-user-messages.test.ts` covers a nested library PDF and asserts that the known
  Python/Microsoft Store/absolute-path diagnostic cannot occur in the new reader copy.

## Still deliberately pending

Auto-backup lifecycle and detached chat involve wider process/UI ownership than the two
safe visual fixes above. They remain P0-0 work, but should land with a dedicated scheduler
and legacy-conversation compatibility test rather than be folded into a reader-state patch.
