# ADR 0002: Stable document identity and project reuse

Status: Accepted

Documents use UUID `documentId`; path and filename are mutable. SHA-256 supports recovery, while DOI/patent numbers help portable restore. One document may link to multiple projects. Legacy `.annot` path fields remain readable and in backups until a separately approved migration removes them.
