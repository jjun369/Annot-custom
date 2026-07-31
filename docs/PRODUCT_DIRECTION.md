# Product direction

Status: Implemented direction for PageDock 0.4.

PageDock is a local-first Windows 10/11 x64 PDF study and technology-research workspace for an individual user. Windows is the only supported desktop platform. It should remain useful without AI, require no development tools from recipients, and keep every person's library, accounts, credentials, notes, and analyses on that person's computer.

The `리서치` area organizes papers, patents, conference material, product material, and public technical sources into projects. Its first priority is accurate, evidence-linked analysis of a user-selected document. For CIS work, pixel/device/process implementation and performance trade-offs matter more than generic summaries.

Product principles:

- Stable document identity independent of filename and folder.
- One original document can be linked to many projects.
- Local exact search first; Codex adds query expansion and detailed analysis but is optional.
- Every analytical claim distinguishes source text, figure interpretation, technical inference, and uncertainty.
- Only lawful public originals are downloaded automatically, and only after approval.
- Data stays local and backups remain portable when a Windows user changes PCs or library paths.
- Unstructured personal notes may enter a review-gated knowledge inbox. Codex proposes topic updates or conflicts, but never overwrites the source note or wiki without user approval.

The experimental knowledge area turns loose technical notes into a personal topic wiki. It uses the existing Codex sign-in rather than a direct model API, sends only locally selected candidate topics, and preserves source-note provenance and revision history.

The user remains able to work without AI: drafts persist locally, wiki Markdown can be edited directly into a new revision, historical revisions can be moved to recoverable trash, and authentication failures never disable local browsing or force an automatic logout.

Out of scope for 0.4: macOS/Linux support, company data or internal models, FTO/legal conclusions, cloud collaboration, bulk crawling, embeddings, weekly radar, technology maps, automatic terminology dictionaries, and WebView2 migration.
