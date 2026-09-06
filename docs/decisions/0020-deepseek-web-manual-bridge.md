# ADR 0020: DeepSeek is a manual web bridge, not an automated web client

Status: Accepted in the working tree.

## Context

PageDock's primary AI can answer a PDF-selection question through its existing authenticated provider path. Some readers also want to request a second point of view from DeepSeek without introducing a second paid API dependency or turning a consumer web chat into a background integration. The useful unit is a narrow, source-anchored question, not the full PDF or personal workspace.

## Decision

1. The initial secondary-provider experience is a visible `설정 → AI → DeepSeek 웹 보조` manual bridge. It never becomes a hidden or privileged login surface.
2. PageDock offers the flow only on an existing completed selection-anchored assistant answer. It reconstructs a preview from that exact selected text and the linked original user question; the reader explicitly copies, reviews, pastes, and sends it in DeepSeek.
3. Electron opens DeepSeek in an independent persistent BrowserWindow partition with no PageDock preload and restrictive web preferences. PageDock does not automate DOM actions, inspect the page, collect credentials, read cookies or web storage, or claim the web session's authentication state.
4. A response returns only through an explicit user paste. The server validates the existing source/linked question and reconstructs the canonical prompt before persisting an additive `secondaryPerspectives` record on the original assistant message.
5. A comparison is descriptive and local. It cannot decide which answer is correct, resolve study state, write a knowledge note, or create a study card.
6. The separate web session may be cleared without touching Library records. Existing session JSON, portable backup v2, and SQLite schema 1 remain unchanged.

## Consequences

Readers can use an already logged-in DeepSeek web account for a small number of deliberate cross-checks while seeing exactly what is sent and retaining the result at the same PDF anchor. The product does not promise unattended throughput, automatic answer capture, web-chat continuity, or verified model metadata. A future official API transport must be separately configured and preserve the same preview, selection-only scope, and user-triggered behavior.
