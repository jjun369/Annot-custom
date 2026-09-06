# Product direction

Status: Implemented direction for PageDock 0.9.

PageDock is a local-first Windows 10/11 x64 PDF study and technology-research workspace for an individual user. Windows is the only supported desktop platform. It should remain useful without AI, require no development tools from recipients, and keep every person's library, accounts, credentials, notes, and analyses on that person's computer.

The first PageDock experience is reading a local PDF: select a sentence, mark what matters or remains unclear, optionally ask AI about that exact source, turn a useful source into an editable recall or manual-cloze card, or promote it to a Finding/Verify/Discuss/Try with the work interpretation in the existing note. A professional reader can also draw one exact region around a figure, table, equation, or process condition and attach a short memo without turning a derived screenshot into a second source of truth. A reader can return to every saved source, close an action independently of learning state, see one deliberate continue-reading action plus a small unresolved cue before reopening the PDF, and export the current PDF's concise Evidence Brief for a meeting or working note. Research and Knowledge extend this Reader workflow; they do not replace the PDF Reader with a chat-first notebook.

The `리서치` area organizes papers, patents, conference material, product material, and public technical sources into projects. Its first priority is accurate, evidence-linked analysis of a user-selected document. For CIS work, pixel/device/process implementation and performance trade-offs matter more than generic summaries.

Product principles:

- Stable document identity independent of filename and folder.
- One original document can be linked to many projects.
- Local exact search first; Codex adds query expansion and detailed analysis but is optional.
- Every analytical claim distinguishes source text, figure interpretation, technical inference, and uncertainty.
- Only lawful public originals are downloaded automatically, and only after approval.
- Data stays local and backups remain portable when a Windows user changes PCs or library paths.
- A reader may create a deliberate, read-only mobile PDF projection in a separately selected sync folder. This is a derived convenience copy, never live library/cloud synchronization or a second source of truth.
- Unstructured personal notes may enter a review-gated knowledge inbox. Codex proposes topic updates or conflicts, but never overwrites the source note or wiki without user approval.

The experimental knowledge area turns loose technical notes into a personal topic wiki. Reader highlights and AI answers may enter its immutable inbox only after the user confirms a provenance class: `문헌 주장`, `업무 관찰`, `개인 가설`, or `AI 추론`. This classification describes origin, not truth, quality, or confidence. It uses the existing Codex sign-in rather than a direct model API, sends only locally selected candidate topics, and preserves source-note provenance and revision history.

Publication age alone is never a reason to relabel, expire, hide, or replace knowledge. A user may explicitly request a topic revisit; completing that revisit writes only a last-reviewed time, not a synthetic content revision. Actual source-content replacement remains governed by the existing stable-document identity conflict flow.

The user remains able to work without AI: drafts persist locally, wiki Markdown can be edited directly into a new revision, historical revisions can be moved to recoverable trash, and authentication failures never disable local browsing or force an automatic logout.

An optional side-chat popup may hold a free local AI conversation or a deliberately bounded cross-check outside the active PDF history. It preserves the Reader's source identity when handed off, keeps provider/web state separate, and uses visible prompt copy plus user-controlled web paste/send rather than consumer-web automation. The Reader and its exact-source return remain the primary workflow.

Out of scope for 0.4: macOS/Linux support, company data or internal models, FTO/legal conclusions, cloud collaboration, bulk crawling, embeddings, weekly radar, technology maps, automatic terminology dictionaries, and WebView2 migration.
