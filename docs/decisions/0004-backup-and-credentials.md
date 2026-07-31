# ADR 0004: Normalized backup and protected credentials

Status: Accepted

Backup v2 exports research tables to normalized JSON instead of copying a live SQLite/WAL set. Restore remaps by hash/DOI and continues accepting v1. Source/API secrets live outside the library and are encrypted with Windows DPAPI; backups, logs, source, and installers never contain them.
