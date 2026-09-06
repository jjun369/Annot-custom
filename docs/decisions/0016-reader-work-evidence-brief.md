# ADR 0016: Reader-local work evidence stays on Highlight

Status: Accepted for PageDock 0.9.0.

PageDock's professional-reader value comes from retaining exact paper evidence while a user decides what it means for a product, process, design, or team discussion. The next feature must complete that loop without changing the local PDF Reader into a project-management application.

The canonical record remains the existing anchored `Highlight`. It may add only optional `workKind: finding | verify | discuss | try` and `workDoneAt`. The existing `note` is intentionally reused for the user's interpretation, conclusion, question, or proposed trial. There is no second work-text field, task ID, project/meeting link, assignee, deadline, priority, tag, history, or status object. Existing highlights that omit `workKind` remain ordinary without a migration write.

Finding represents a recorded interpretation and never has a completion state. Verify, Discuss, and Try are open when `workDoneAt` is absent and done when it is present. Work completion is independent from study `resolvedAt`; changing a work kind or removing Work clears `workDoneAt` so an old completion cannot leak into a new meaning.

The feature remains inside the current PDF Reader: a compact selection action, the existing highlight dialog/list, and a current-PDF Evidence Brief Markdown export. The brief includes only explicitly promoted highlights, groups Findings/open/completed follow-ups, retains exact evidence text, and uses the existing `?pdf=&page=` Reader link convention. It does not create a new deep-link protocol or persistent path identity.

The fields are sidecar-only metadata. Native PDF annotations still carry only existing text, note, and legacy type, so work-only PATCH operations do not require Python/PyMuPDF. SQLite schema 1, sidecar version 1, backup manifest v2, sessions, and metadata remain unchanged; ordinary sidecar backup/restore and rename/move preservation continue to carry the fields.
