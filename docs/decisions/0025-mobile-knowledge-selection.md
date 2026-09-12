# ADR 0025: Explicit Knowledge selections in the mobile reading copy

Status: Accepted

Date: 2026-09-08

## Context

ADR 0019 limits mobile content to explicitly selected PDFs and their linked records. This excludes useful standalone Knowledge topics and captured memos. The user now requests read-only phone access to collected knowledge and notes, while retaining recoverable backups.

## Decision

- Extend the existing device-local Mobile Shelf with explicit topic and note IDs. Missing legacy arrays mean no standalone selection; reading settings never selects content or migrates Library data.
- Allow publication with selected Knowledge records and no selected PDF. Continue writing the same self-contained phone-width `Mobile/PageDock-Mobile.pdf` and small integrity receipt. No mobile server, account, new app, two-way editing, or cloud upload API is introduced.
- Settings provides a bounded, searchable summary picker. Adding a record is deliberate; new unrelated notes are never automatically selected. Missing selections stay visible and are reported when publishing.
- Selected current topic bodies and selected raw captured notes are projections, not a second Knowledge database. Preserve their distinct provenance, status, dates, and available source-page references. A captured memo or AI inference must not be presented as a verified topic. Avoid repeating a selected topic already projected through a selected PDF.
- Changes to selected content mark the existing mobile copy dirty. Automatic publication remains opt-in and uses existing debounce/rate limits. Read operations never publish. Existing external-modification protection remains in force.
- Independent side-chat conversations and reflections are not implicitly added. This selection extension does not promote, resolve, edit, or send any content to AI.
- Recoverable backups remain the existing portable ZIP v2 with v1 import support. Original PDF inclusion still differs between full manual and metadata-only automatic backups. Mobile selection settings remain device-local and excluded from Library backup.

## Consequences

The mobile PDF is a convenient reading copy, not complete history or a recovery archive. Users choose an external folder and transfer the generated file themselves or use their existing folder-sync service. PageDock can report a completed folder write, never successful remote synchronization. Native phone/device testing and individual reader offline behaviour must not be inferred from desktop PDF rendering.
