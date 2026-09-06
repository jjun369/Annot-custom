# ADR 0013: Portable source-anchored recall cards

Status: Accepted for PageDock 0.6.0.

PageDock adds recall cards to complete its PDF learning loop. Cards are stored as optional `study.cards` data in the existing document annotation sidecar, not in SQLite, a new Study Space root, or a separate companion file.

Each card reuses the existing `ChatSourceContext` locator with stable `documentId`, page, optional rects, and bounded source text. It deliberately does not save an absolute or relative PDF path in card identity, a highlight-id-only reference, or a new parallel anchor type. This means deleting a source highlight does not erase the card's source snapshot, while existing document rename/move resolution still applies.

The v1 sidecar and backup v2 manifest remain unchanged. Existing sidecars are not rewritten on read; missing `study` state is interpreted as an empty card list. Highlight and card updates use one per-sidecar atomic write path so one mutation does not overwrite the other with a stale snapshot.

P1 review state is limited to `reviewCount`, `lastReviewedAt`, and `lastResult` (`again` or `remembered`). Scheduling algorithms, event history, daily queues, notifications, gamification, automatic cards, and cross-document indexes are deferred. AI may provide an editable answer-derived card draft, but manual source-anchored cards and review remain fully functional without AI or Python/PyMuPDF.
