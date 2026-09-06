# DeepSeek Web Manual Bridge

## Purpose

This optional Reader feature gives a learner one additional perspective on a precise PDF selection anchor. It can start from a saved user question even when the primary AI has not answered; it is not an automatic judge, a provider replacement, or a general chat integration.

## Deliberate flow

1. The reader selects one bounded PDF excerpt and enters a question. `DeepSeek 웹에 물어보기` is an explicit choice; it does not require a primary AI turn or provider login.
2. PageDock saves the question and exact source anchor in the existing PDF session before showing the outbound prompt. A primary AI failure leaves that question recoverable locally.
3. PageDock shows the exact outbound prompt. It contains only the stored selection and the original user question. The import action can be reopened later from the persisted user question or assistant answer; it does not depend on an in-memory request map.
4. After an explicit confirmation, PageDock copies that prompt and opens the DeepSeek web window. The reader signs in, pastes, reviews, and sends in DeepSeek directly.
5. The reader copies a response from DeepSeek and explicitly pastes it into PageDock.
6. PageDock saves it additively against the persisted user question, or against the original PageDock answer when one exists. It can show the saved answer list, the original question, the collapsible source excerpt, and either one manual explanation or both explanations without declaring a winner. The comparison uses the same Markdown/math rendering as the primary chat and can return to the source page.

The feature is intentionally available only for a selection source context. Current-PDF and current-page messages lack a bounded text payload and cannot silently expand the outgoing scope.

## What leaves PageDock

The reviewed prompt contains the selected source text and the original question. It does not contain a PDF filename or path, the rest of the PDF, surrounding page text, personal/work/Knowledge notes, existing PageDock answer, cards, backup data, or another conversation turn.

The prompt says that the excerpt is untrusted source material, not an instruction. A reader remains responsible for deciding whether sending the displayed text to DeepSeek is appropriate.

## Web session and credentials

Settings exposes `AI → DeepSeek 웹 보조`; it is not a hidden debug page. The desktop app opens `chat.deepseek.com` in a separate Electron partition named `persist:pagedock-deepseek-web`. Login happens entirely in that web window. PageDock does not automate the site, inject scripts, send prompts, read answers, inspect cookies/local storage, or store passwords/tokens.

The separate session can be cleared in Settings. That deletes only the DeepSeek web partition's site data and cache; it does not delete PDFs, annotations, sessions, or already imported manual perspectives.

## Local storage and backup

An imported response is an optional `ChatMessage.secondaryPerspectives[]` record in the existing PDF session JSON. It retains the manual acquisition label, source/linked-question message IDs, displayed prompt snapshot and SHA-256 receipt, response text, import time, an optional request time, and unknown model value. A direct flow stores it on the user anchor with the source and question IDs equal; an existing primary flow stores it on the assistant and points to its user question. If a request is recovered after its original request time is no longer known, PageDock omits that time rather than inventing one. Existing session JSON is backward compatible and already included in portable backups; there is no SQLite migration, sidecar version change, or backup-manifest change.

Session mutations use a per-`sessions.json` file lock and a latest-read domain patch. Chat completion saves the user question before the provider call, then appends only the assistant to the latest session; manual import patches only the anchored message's perspective list. Repeating the same normalized response for the same anchor, canonical prompt, and prompt hash returns the existing record; a different response remains additive. Deletion and rename/move writers use the same lock boundary so a removed session is not recreated by a stale writer.

## Boundaries and future work

The comparison does not score answers, manufacture a consensus, auto-resolve a highlight, create a recall card, or promote text into Knowledge. The initial release has no DeepSeek API key, consumer-web automation, polling, remote history sync, multi-PDF context, or model-name claim. A future API transport, if added, must stay separately configured and preserve the same explicit, selection-only outbound review.
