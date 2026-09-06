# ADR 0014: Date-only current-PDF recall queue

Status: Accepted for PageDock 0.7.0.

Source-Anchored Recall cards need a minimal answer to “when should I see this again?” before PageDock adds card types, a global study area, or an adaptive scheduling algorithm. The queue remains scoped to the PDF that is currently open.

The canonical state remains optional `study.cards` data in the existing v1 annotation sidecar. A card’s existing `review` object gains one optional `nextReviewDate` field in `YYYY-MM-DD` local-calendar form. It is not a UTC timestamp and no due-date index, event log, SQLite table, new sidecar, backup-manifest change, or scheduler service is introduced.

New cards use today. A review result updates the existing count/time/result and exactly one next date: `again` becomes tomorrow, `remembered` becomes three calendar days later. Calendar-day addition avoids a 24-hour millisecond calculation, so the behavior remains correct across local daylight-saving transitions. No interval, ease, streak, lapse, or score is persisted.

Cards written by PageDock 0.6 lack `nextReviewDate`. They are interpreted as due in the current-PDF queue, but reads never migrate or rewrite the sidecar. A date is persisted only after a new card is created or a learner explicitly reviews one. This preserves portable backups, Python-free/offline use, document identity, and source-anchor behavior.
