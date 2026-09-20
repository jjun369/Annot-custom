# Research (리서치)

Status: Implemented core in 0.4.4; large-document indexing now reports progress and supports safe cancellation. AI query expansion and richer provider normalization remain planned.

The user-facing area is named `리서치`. The screen has project navigation, unified search/results, and document detail/analysis. It includes generic, image-sensor PA, and logic-semiconductor profiles; users can copy/edit focus areas, questions, metrics, and terminology.

Implemented:

- Project/document many-to-many organization.
- Local FTS5 over title, abstract, indexed PDF pages, patent claims, tags, and personal paper notes.
- Crossref and configured OpenAlex metadata search, configured Unpaywall DOI lookup, manual PDF and URL/number patent workflows.
- A calm, collapsible source-finding guide in the Research search flow points readers to Crossref/OpenAlex for title or DOI discovery and Unpaywall, author repositories, or institutional libraries for lawful public copies. It does not support or recommend unofficial paywall-bypass/mirror routes such as Sci-Hub; public PDF import remains user-approved and the provider's terms remain the user's responsibility.
- KIPRIS Plus and EPO OPS authenticated search with explicit authentication/quota errors, plus KIPRIS/Espacenet/Google Patents links when credentials are absent.
- User-approved public PDF import with HTTPS, redirect, private-network, size, and PDF validation.
- Manual patent metadata/claims, filename suggestions, confirmed physical rename, display-title editing.
- Project rename/delete and editable profile terminology in `대표 용어 = 동의어, 영문 표현` form.
- On-demand Codex structured analysis and evidence links back to PDF pages.
- Evidence rejection when page/quote does not exist in indexed source text.
- Visible recovery confirmation for ambiguous hashes.
- Single-flight background PDF indexing with real page progress, cancellation during extraction, and an explicit non-cancellable save boundary.
- JSONL Python/PyMuPDF extraction streamed into disposable OS-temp NDJSON staging; only a verified unchanged source is atomically committed to SQLite/FTS.

Analysis output covers the central idea, prior problem, structure, process, possible extra steps, performance effects, trade-offs, independent-claim scope, embodiments, similar work, related documents, uncertainty, and conclusion. Evidence is labeled `원문 명시`, `도면 해석`, `기술적 추정`, or `불확실`.

Planned follow-up: Codex-assisted query expansion/reranking, richer KIPRIS Plus citation parsing, EPO OPS family/legal-event normalization, and stronger PDF author/year/patent-number extraction. External search/manual import remains the no-key fallback.

If PageDock restarts during indexing, the disposable job state disappears; any prior completed index remains intact and the user can start again. Acceptance requires responsive long-PDF indexing, Korean/English mixed search, no-AI fallback, explicit download approval, correct page navigation, and no fabricated evidence anchors.
