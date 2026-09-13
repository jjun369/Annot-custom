# NAS 보호 사본

Status: Implemented in PageDock 0.9.2.

## What it protects

`NAS 보호 사본` is a deliberately boring recovery path for the records that make
reading progress personal: annotation sidecars, reading positions, sessions,
Knowledge JSON, and normalized research export. It copies the existing
PDF-excluding portable backup ZIP only after PageDock has completed and verified
that ZIP locally. The source PDF archive is expected to remain in the user's NAS
paper folder or another separately managed archive.

It is not NAS sync. PageDock never opens its SQLite database, `.annot` files, or
active PDFs from the selected folder, and it never asks for or stores Synology
credentials. A failed NAS copy cannot block an underline, memo, Reader position,
or local backup.

## Setup with Synology

1. In Windows, connect an existing Synology SMB shared folder using Explorer or
   a mapped drive. Confirm that Windows can create and remove an ordinary test
   file there. Do not select the PageDock Library itself.
2. In Settings → `PageDock 복구 백업` → `NAS 보호 사본`, choose a new empty folder
   inside that share. PageDock creates only `PageDock-Backups/Auto` and a
   reserved `Manual` directory there.
3. Press `지금 보호 사본 만들기` once. This creates a fresh local metadata backup,
   checks its embedded manifest and hashes, copies it as a partial file, checks
   the destination bytes, then exposes the final ZIP.
4. Optionally enable `자동 보호 사본`. The existing daily local automatic backup
   will then copy to the selected folder after local success. The NAS location
   keeps the latest fourteen successful automatic ZIPs; PageDock's own local
   location remains the latest three.

The Settings result means only that PageDock wrote and checked files in the
folder Windows exposed. It cannot confirm Synology Drive, an offsite sync
service, or a phone has uploaded/downloaded those files.

## Recovery drill

At least once after setup and then periodically, copy one NAS ZIP to a safe local
folder and use `복구 ZIP 가져오기` against a separate disposable Library. Confirm
that a saved highlight, a reading position, and one Knowledge item are present.
Do not test by replacing the only working Library. Keep the NAS itself backed up
to a USB drive or another location; NAS RAID is not a separate backup.

## Deliberate limits

- Automatic snapshots exclude original PDFs to avoid repeatedly copying a large
  paper archive. Use the existing full ZIP export/manual backup when a portable
  PDF-inclusive archive is required.
- PageDock does not scan thousands of NAS PDFs, cache NAS credentials, host a
  Synology web app, merge phone edits, or treat NAS files as live state.
- Image notes and durable user-uploaded circuit/screenshot assets require a
  separate data-model decision. Existing visual regions remain source anchors
  and are rendered only into the read-only mobile PDF.
