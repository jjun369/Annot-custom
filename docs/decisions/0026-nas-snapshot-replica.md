# ADR 0026: NAS snapshot replica remains a passive recovery target

Status: Accepted

Date: 2026-09-13

## Context

PageDock users may keep a large PDF archive on a Synology NAS while the Windows
app holds the active Library, annotation sidecars, sessions, Knowledge records,
and a rebuildable SQLite search index. Those study records are more difficult to
recreate than the source PDF. Putting the active Library, SQLite/WAL, or `.annot`
files on SMB/NFS, or allowing a bidirectional sync client to operate on them,
creates a partial-write and conflict boundary in the middle of a short offline
study session.

At the same time, a local-only latest copy is not sufficient protection against a
lost Windows drive or a bad local change being discovered later.

## Decision

1. The active PageDock Library remains on the Windows local filesystem. A NAS is
   an archive/source-import location and passive recovery replica, never a live
   PageDock filesystem.
2. A device-local, opt-in `backup-replica.json` stores only a user-selected
   folder path and small operational state. It stores no NAS URL, password,
   Synology account, token, sync cursor, or Library content. A Windows-mapped SMB
   folder is the intended first NAS connection.
3. PageDock first creates and manifest-verifies the existing local portable v2
   automatic archive (which excludes PDFs). Only then may it copy the exact ZIP
   to `<selected>/PageDock-Backups/Auto`. The destination copy uses a unique
   `<file>.<random>.partial` name, hashes the completed partial against the local source, and
   renames it to a visible ZIP only after verification. A completed ZIP already
   contains the portable-backup manifest and file hashes.
4. Automatic replica copying is off by default. A user may request `지금 보호
   사본 만들기` even when automatic copying is off. Copy failure is recorded as
   operational state and shown in Settings, but cannot roll back or delay the
   local Library save or successful local backup.
5. The replica keeps the latest fourteen successful automatic ZIPs separately
   from the existing three local automatic ZIPs. It never overwrites a
   same-named, different ZIP and never automatically deletes manual files.
6. The current portable backup v2 manifest, SQLite schema, annotation-sidecar
   version, document identity, mobile bridge, and restore format do not change.
   A NAS app, remote database, filesystem watcher, two-way sync, direct NAS PDF
   reading, and image-attachment storage are deferred.

## Consequences

The first Synology workflow is intentionally unglamorous: keep the full source
PDF archive on NAS, import a deliberate local working set into PageDock, and copy
small, versioned study-record snapshots back to NAS. It continues to work when
the NAS is asleep or unreachable because the Reader writes only locally.

The replica is not the final backup layer. Users should use Hyper Backup or an
equivalent NAS-to-external/second-location backup and periodically restore a
snapshot into a separate test Library. RAID and a single NAS volume improve
availability; they do not provide an independent recovery history.
