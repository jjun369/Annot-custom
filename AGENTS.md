# PageDock repository instructions

Before changing code, read these files in order:

1. `docs/PRODUCT_DIRECTION.md`
2. `docs/CURRENT_STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DATA_MODEL.md`
5. The relevant file under `docs/features/` and all related ADRs under `docs/decisions/`

## Working rules

- Preserve user PDFs and all existing `.annot` JSON formats. Never delete or rewrite user data without an explicit, tested migration and rollback path.
- Treat paths and filenames as mutable attributes. `documentId` is the stable identity of a registered document.
- Keep the app local-first. Credentials, personal email addresses, proprietary documents, PDF originals, and company information must never enter source control, logs, fixtures, or documentation.
- Treat Windows 10/11 x64 as the only supported desktop platform. Do not spend project time on macOS/Linux builds, tests, packaging, signing, or compatibility unless the product direction is explicitly changed by a later ADR.
- Only automatically download lawful public copies after user approval. Do not implement paywall bypasses, Sci-Hub, mirror discovery, or publisher credential collection.
- Legal status is informational; PageDock does not make freedom-to-operate determinations.
- Inspect `git status` and run existing checks before editing. Preserve unrelated user changes.
- After a change, run `npm run docs:check`, `npm run lint`, `npx tsc --noEmit --incremental false`, and the relevant tests/build. Test migrations and v1/v2 backup compatibility for data changes.
- Update `docs/CURRENT_STATE.md`, `docs/ROADMAP.md`, and `CHANGELOG.md` whenever implementation or user-visible behavior changes.

An ADR is required before changing document identity, making an incompatible database/schema change, changing backup format, credential storage, AI/source-provider policy, or the release repository/automatic-update mechanism.
