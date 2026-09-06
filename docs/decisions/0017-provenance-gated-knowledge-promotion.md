# ADR 0017: Knowledge promotion is provenance-gated, not truth-scored

Status: Accepted in the working tree after PageDock 0.9.

## Context

A professional reader needs to retain useful paper excerpts, work observations, personal technical ideas, and AI explanations. Treating all retained text as equal “knowledge” creates a long-term risk: an old paper, a context-specific observation, or an AI synthesis can be reread later as a universal fact.

PageDock already has a loss-averse Reader, anchored sessions, immutable Knowledge notes, review-gated topic proposals, and revisioned wiki state. The next change must use that substrate rather than create a parallel note database or a confidence/ranking system.

## Decision

1. A Reader highlight and a persisted assistant answer may be sent only to the existing immutable Knowledge inbox. Neither may directly mutate a topic or create a wiki revision.
2. The user confirms one provenance class: `literature_claim`, `work_observation`, `personal_hypothesis`, or `ai_inference`. This declares origin only; it never declares truth, freshness, authority, or confidence.
3. Promotion preserves the existing bounded `ChatSourceContext` anchor. Highlight notes become an optional collection memo. AI answers retain answer/provider/model/generation metadata only when classed as `ai_inference`.
4. Optional provenance and review-attention fields are added to the existing format-2 knowledge JSON. SQLite schema 1, annotation-sidecar version 1, session shape, and portable backup manifest v2 do not change.
5. A topic may be manually marked for revisit. Completing an unchanged review only records the review time; it creates no content revision and does not change topic body or `updatedAt`.
6. Time alone never creates a stale, expired, review-required, or false state. The only future automatic attention candidate is an actual source-content identity/revision event under the existing document-conflict contract.

## Consequences

The interface gives a small but explicit distinction between literature, work observation, personal hypothesis, and AI inference. Existing historic Knowledge data remains usable and is labelled `유형 미지정 · 기존 지식`; it is never rewritten merely by reading it.

This feature intentionally does not add automatic semantic classification, AI-first personal-note chat, figure crops, citations, vector search, a global graph, cloud sync, or collaboration. Those additions would either broaden the privacy boundary or make the origin contract harder to understand before real professional reading use validates it.

## Verification

Tests cover additive note/topic persistence, anchor preservation, manual review with no revision/body/updated-time mutation, missing old metadata, invalid source-boundary inputs, and the existing knowledge/readers regression suite. Portable backup carries the JSON unchanged as an existing ordinary library entry.
