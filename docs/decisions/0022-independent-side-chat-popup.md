# ADR 0022: Independent side-chat popup with explicit web handoff

Status: Accepted in the working tree.

## Context

Short PDF-reading sessions sometimes need a scratch conversation or a second explanation without adding either to the current PDF conversation. The existing Reader chat is intentionally tied to the active PDF session, while consumer web chats must remain manual and must not be treated as an API or automated browser surface.

## Decision

1. Add a small Reader action that opens a separate Electron popup at `/side-chat`. Its local `sessionKind: "sidechat"` sessions live in the root `.annot/sessions.json` namespace and never share the active PDF session's messages, `providerSessionId`, or history. The legacy `/chat-window` route is unchanged.
2. PageDock AI in the popup reuses the existing Codex/Claude runtime, but side-chat turns run with a temporary working directory and no implicit Library, PDF, Knowledge, or folder-tool context. A side-chat question is saved locally before the optional provider call; failures and drafts remain recoverable.
3. A Reader selection may be handed to the popup as an immutable bounded `ChatSourceContext` snapshot plus a relative path hint. The user must send the question explicitly. Source return prefers the stable `documentId` and preserves page/rects; the path is only a mutable navigation hint.
4. The popup includes DeepSeek, ChatGPT, Claude, and Gemini as a fixed registry of official top-level web destinations. Each provider gets its own Electron `WebContentsView` partition. PageDock never injects DOM, sends/polls content, reads cookies, handles credentials, or assumes that a login succeeded. Unsupported load or embedding failures fall back to the system browser.
5. Web handoff has three explicit modes: question only, selected source plus question, or selected source plus question plus a user-selected PageDock answer. PageDock previews the exact payload, copies it only after a user click, and leaves paste/send to the user. Pasted web answers are additive `sideChatPerspectives[]` records on the local question with a prompt version/hash and factual `user-paste` acquisition label; unknown model text is never inferred.
6. The new fields are optional JSON additions. Portable backup v2 automatically carries the root side-chat session file, and v1 import/read behavior remains unchanged. SQLite schema, existing PDF receipts, legacy assistant-owned DeepSeek imports, and backup manifest format are not reinterpreted or migrated.

## Consequences

The reader can keep a scratch or cross-check conversation outside the PDF history and return to the exact source without losing popup state. The first version is deliberately semi-manual: outbound data is visible and bounded, while the user controls web login, paste, and send. Multiple web explanations are comparable references, not an automatic winner or truth judgment. The popup's web tabs may require a normal browser fallback when the Electron runtime cannot safely embed a provider.
