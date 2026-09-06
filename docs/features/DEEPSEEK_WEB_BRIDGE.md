# DeepSeek Web Manual Bridge

## Purpose

This optional Reader feature gives a learner one additional perspective on a question that already has a precise PDF selection anchor. It is a cross-check aid, not an automatic judge, a provider replacement, or a general chat integration.

## Deliberate flow

1. The reader asks PageDock AI about a single selected PDF excerpt.
2. On the completed anchored answer, the reader chooses `다른 관점 보기`.
3. PageDock shows the exact outbound prompt. It contains only the stored selection and the original user question.
4. After an explicit confirmation, PageDock copies that prompt and opens the DeepSeek web window. The reader signs in, pastes, reviews, and sends in DeepSeek directly.
5. The reader copies a response from DeepSeek and explicitly pastes it into PageDock.
6. PageDock saves it against the original PageDock answer and can show both answers side by side without declaring a winner.

The feature is intentionally available only for a selection source context. Current-PDF and current-page messages lack a bounded text payload and cannot silently expand the outgoing scope.

## What leaves PageDock

The reviewed prompt contains the selected source text and the original question. It does not contain a PDF filename or path, the rest of the PDF, surrounding page text, personal/work/Knowledge notes, existing PageDock answer, cards, backup data, or another conversation turn.

The prompt says that the excerpt is untrusted source material, not an instruction. A reader remains responsible for deciding whether sending the displayed text to DeepSeek is appropriate.

## Web session and credentials

Settings exposes `AI → DeepSeek 웹 보조`; it is not a hidden debug page. The desktop app opens `chat.deepseek.com` in a separate Electron partition named `persist:pagedock-deepseek-web`. Login happens entirely in that web window. PageDock does not automate the site, inject scripts, send prompts, read answers, inspect cookies/local storage, or store passwords/tokens.

The separate session can be cleared in Settings. That deletes only the DeepSeek web partition's site data and cache; it does not delete PDFs, annotations, sessions, or already imported manual perspectives.

## Local storage and backup

An imported response is an optional `ChatMessage.secondaryPerspectives[]` record in the existing PDF session JSON. It retains the manual acquisition label, source/linked-question message IDs, displayed prompt snapshot and SHA-256 receipt, response text, times, and unknown model value. Existing session JSON remains backward compatible and is already included in the portable backup; there is no SQLite migration, sidecar version change, or backup-manifest change.

## Boundaries and future work

The comparison does not score answers, manufacture a consensus, auto-resolve a highlight, create a recall card, or promote text into Knowledge. The initial release has no DeepSeek API key, consumer-web automation, polling, remote history sync, multi-PDF context, or model-name claim. A future API transport, if added, must stay separately configured and preserve the same explicit, selection-only outbound review.
