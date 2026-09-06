# ADR 0019: Mobile bridge is a derived PDF and backup boundary

Status: Accepted in the PageDock 0.9 working tree.

## Context

PageDock is a Windows-first local PDF study application. A reader may want to revisit a small, deliberate subset of study records on a phone through Google Drive, OneDrive, Dropbox, or an ordinary synced folder. Copying the live Library, SQLite database, `.annot` files, or sessions into a sync folder would turn file synchronization into an unsafe two-way data store and would make mobile edits ambiguous.

## Decision

1. The active PageDock Library remains the only live source of truth. The bridge is a user-selected, device-local external folder and must be separate from the Library.
2. The bridge is provider-neutral and has `Mobile`, reserved `Inbox`, `Backups/Manual`, and `Backups/Auto` folders. PageDock does not use Google OAuth, Drive APIs, or a provider-specific completion signal.
3. The mobile artefact is one self-contained `Mobile/PageDock-Mobile.pdf`, designed for a phone-width single column. `Mobile/manifest.json` contains only schema version, export id, time, artifact file name, and PDF SHA-256; it is a receipt, not a second database.
4. Only documents explicitly added to the device-local Mobile Shelf by stable `documentId` are included. Automatic mobile publishing is an explicit, device-local opt-in and defaults to off. When enabled, only changes that alter the projected PDF make it dirty; those changes coalesce after 90 seconds of inactivity and successful automatic publishes are limited to one per ten minutes. Documents outside the shelf never publish automatically.
5. Visual records keep their existing source-only page/normalized-rectangle contract. A crop is rendered in memory during export, embedded in the derived PDF, and never stored as a durable sidecar asset.
6. If the canonical mobile PDF and receipt no longer match, PageDock blocks automatic overwrite. The user may explicitly preserve the modified pair below `Mobile/Conflicts` and then create a fresh canonical snapshot. There is no import, merge, or mobile-PDF annotation ingestion.
7. Automatic backup remains a v2 portable backup without PDFs: write a local partial ZIP, validate it, publish it locally, then copy the exact same bytes to bridge `Backups/Auto` when configured. Local and bridge locations independently retain their latest three successful automatic ZIPs. Manual bridge backups include PDFs and have no automatic cleanup.

## Consequences

The phone experience is one direct PDF open and one offline file rather than a Markdown/assets package. Closing PageDock never forces a render; a durable dirty marker remains for the next manual publish or opted-in automatic opportunity. Normal external-folder I/O failures receive one delayed retry and then require a user action or a later relevant change. The bridge remains useful with any filesystem sync service, but PageDock can only state that it wrote to the linked folder; it cannot claim the remote cloud service has completed upload. Inbox ingestion, two-way editing, cloud sync, full-library projection, encrypted bridge files, automatic mobile content selection, and persistent image crops remain outside this decision.
