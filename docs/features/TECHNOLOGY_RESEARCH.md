# Research (리서치)

Status: Implemented core in 0.4; provider enhancements noted below.

The user-facing area is named `리서치`. The screen has project navigation, unified search/results, and document detail/analysis. It includes generic, image-sensor PA, and logic-semiconductor profiles; users can copy/edit focus areas, questions, metrics, and terminology.

Implemented:

- Project/document many-to-many organization.
- Local FTS5 over title, abstract, text/claims, tags, and indexed PDF pages.
- Crossref and optional OpenAlex metadata search, Unpaywall lawful-copy discovery, manual PDF and URL/number patent workflows.
- KIPRIS Plus and EPO OPS authenticated search with explicit authentication/quota errors, plus KIPRIS/Espacenet/Google Patents links when credentials are absent.
- User-approved public PDF import with HTTPS, redirect, private-network, size, and PDF validation.
- Manual patent metadata/claims, filename suggestions, confirmed physical rename, display-title editing.
- On-demand Codex structured analysis and evidence links back to PDF pages.
- Evidence rejection when page/quote does not exist in indexed source text.
- Visible recovery confirmation for ambiguous hashes.

Analysis output covers the central idea, prior problem, structure, process, possible extra steps, performance effects, trade-offs, independent-claim scope, embodiments, similar work, related documents, uncertainty, and conclusion. Evidence is labeled `원문 명시`, `도면 해석`, `기술적 추정`, or `불확실`.

Planned follow-up within the provider layer: richer KIPRIS Plus citation parsing and EPO OPS family/legal-event normalization. External search/manual import remains the no-key fallback.

Acceptance requires responsive long-PDF indexing, Korean/English mixed search, no-AI fallback, explicit download approval, correct page navigation, and no fabricated evidence anchors.
