# ADR 0021: Save a bounded user question before the manual DeepSeek flow

Status: Accepted in the working tree.

## Context

The Reader's useful unit is a selected PDF excerpt plus the reader's own question. Requiring a completed primary AI answer made the manual DeepSeek path unavailable when the primary provider was offline, over quota, or not configured. The question also disappeared on reload if the primary turn failed before its final save.

## Decision

1. For a user-selected, one-page `selection` source only, the explicit `DeepSeek 웹에 물어보기` action saves the question as an ordinary `user` `ChatMessage` in the existing PDF session before any web copy/open action. No provider login, quota check, fake assistant, new session, sidecar, SQLite field, or request store is created.
2. The client supplies a stable request ID for retries. The local save is idempotent for the same request ID, question, and bounded source anchor; a conflicting reuse is rejected. If the local save fails, PageDock does not send the prompt remotely and retains the draft in the current UI task.
3. Existing assistant-owned `secondaryPerspectives[]` remain the legacy/primary-linked representation. A direct manual response is stored additively on the persisted user question with `sourceMessageId === questionMessageId`; an assistant-linked response continues to use the assistant as `sourceMessageId`. Readers reconstruct both forms at read time; no reparenting, read-time migration, or synthetic assistant is allowed.
4. The existing `/api/chat` path also persists its user message before the provider call and accepts an optional stable user message ID. A provider failure therefore leaves the question/source anchor local, and a later completion appends an assistant to that existing question rather than duplicating it.
5. The canonical prompt is reconstructed from the persisted bounded source and question at import time and checked against the reviewed snapshot. Only the selected text and question leave PageDock on explicit copy/open; the consumer web page is never automated or read.

## Consequences

Readers can recover a useful question after reload or primary-AI failure and deliberately continue with a manual DeepSeek explanation. A direct explanation is displayed alone because no primary answer exists; comparison appears only when an actual assistant answer is attached. Existing v1/v2 JSON/backup data remains dual-readable, and future API transports must preserve the same explicit selection-only boundary.
